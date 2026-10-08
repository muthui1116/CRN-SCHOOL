// routes/examRoute.js
import db from "../db.js"; 
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import WordExtractor from "word-extractor";
import getGradeAndPoints from "../utils/getGradeAndPoints.js";
import homeworkUpload from "../homeworkUpload.js";
import schemesUpload from "../schemesUpload.js";
import { lessonNoteDocumentHtml, lessonNoteFilename, lessonNoteContentHtml } from "../utils/lessonNoteDocument.js";

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

function isTeacher(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 2) {
    return next();
  }
  return res.redirect("/login");
}

function handleSchemeUpload(req, res, next) {
  schemesUpload.single('document')(req, res, err => {
    if (!err) return next();
    console.error('Scheme upload error:', err);
    const statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(statusCode).render('error.ejs', { message: err.message });
  });
}

const extractSchemeText = async filePath => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') {
    const parser = new PDFParse({ data: await fs.readFile(filePath) });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }
  if (extension === '.doc') {
    const extractor = new WordExtractor();
    const document = await extractor.extract(filePath);
    return document.getBody().trim();
  }
  throw new Error('Unsupported scheme document format');
};

const schemeColumns = [
  { key: 'week', label: 'WK', match: value => /^(wk|week|week no\.?)$/.test(value) },
  { key: 'lesson', label: 'LSN', match: value => /^(lsn|lesson|lesson no\.?)$/.test(value) },
  { key: 'strand', label: 'Strand', match: value => value === 'strand' },
  { key: 'subStrand', label: 'Sub-strand', match: value => value.includes('sub') && value.includes('strand') },
  { key: 'outcomes', label: 'Specific Learning Outcomes', match: value => value.includes('specific') && value.includes('outcome') },
  { key: 'experience', label: 'Learning Experience', match: value => (value.includes('learning') || value.includes('leaning')) && value.includes('experience') },
  { key: 'inquiry', label: 'Key Inquiry Questions', match: value => value.includes('inquiry') && value.includes('question') },
  { key: 'resources', label: 'Learning Resources', match: value => value.includes('learning') && value.includes('resource') },
  { key: 'assessment', label: 'Assessment Methods', match: value => value.includes('assessment') && value.includes('method') },
  { key: 'reflection', label: 'Reflection', match: value => value.includes('reflection') },
];

const emptySchemeRow = () => Object.fromEntries(schemeColumns.map(column => [column.key, '']));

const decodeSchemeHtml = html => html
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|div|li)>/gi, '\n')
  .replace(/<[^>]*>/g, '')
  .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (match, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\r/g, '')
  .trim();

const getTableGrid = tableHtml => {
  const grid = [];
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  rows.forEach(([, rowHtml], rowIndex) => {
    grid[rowIndex] ||= [];
    let columnIndex = 0;
    const cells = [...rowHtml.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    cells.forEach(([, , attributes, cellHtml]) => {
      while (grid[rowIndex][columnIndex] !== undefined) columnIndex += 1;
      const value = decodeSchemeHtml(cellHtml);
      const colspan = Math.max(1, Number(attributes.match(/\bcolspan=["']?(\d+)/i)?.[1]) || 1);
      const rowspan = Math.max(1, Number(attributes.match(/\browspan=["']?(\d+)/i)?.[1]) || 1);
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          grid[rowIndex + rowOffset][columnIndex + columnOffset] = rowOffset === 0 ? value : '';
        }
      }
      columnIndex += colspan;
    });
  });
  return grid;
};

const parseSchemeDocumentHtml = html => {
  const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(([table]) => table);
  let school = '';
  let learningArea = '';
  let rows = [];

  for (const table of tables) {
    const grid = getTableGrid(table);
    const headerIndex = grid.findIndex(row =>
      row.some(cell => /^(wk|week|week no\.?)$/i.test(String(cell || '').trim())) &&
      row.some(cell => /^(lsn|lesson|lesson no\.?)$/i.test(String(cell || '').trim()))
    );

    if (headerIndex < 0) {
      const labels = grid.findIndex(row =>
        row.some(cell => /^school$/i.test(String(cell || '').trim())) &&
        row.some(cell => /^learning area$/i.test(String(cell || '').trim()))
      );
      if (labels >= 0) {
        const values = grid[labels + 1] || [];
        const schoolIndex = grid[labels].findIndex(cell => /^school$/i.test(String(cell || '').trim()));
        const areaIndex = grid[labels].findIndex(cell => /^learning area$/i.test(String(cell || '').trim()));
        school = values[schoolIndex] || '';
        learningArea = values[areaIndex] || '';
      }
      continue;
    }

    const header = grid[headerIndex].map(value => String(value || '').toLowerCase().replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim());
    const indexes = schemeColumns.map(column => header.findIndex(column.match));
    rows = grid.slice(headerIndex + 1)
      .filter(row => row.some(value => String(value || '').trim()))
      .map(row => Object.fromEntries(schemeColumns.map((column, index) => [
        column.key,
        indexes[index] < 0 ? '' : String(row[indexes[index]] || '').trim(),
      ])));
    break;
  }

  return { school, learningArea, rows };
};

const createSchemeTable = (content, grade, term) => {
  try {
    const parsed = JSON.parse(content || '');
    if (parsed?.format === 'scheme-table-v1' && Array.isArray(parsed.rows)) {
      return {
        format: 'scheme-table-v1',
        school: typeof parsed.school === 'string' ? parsed.school : '',
        year: typeof parsed.year === 'string' ? parsed.year : String(new Date().getFullYear()),
        learningArea: typeof parsed.learningArea === 'string' ? parsed.learningArea : '',
        rows: parsed.rows.map(row => Object.fromEntries(schemeColumns.map(column => [
          column.key,
          typeof row?.[column.key] === 'string' ? row[column.key] : '',
        ]))),
      };
    }
    if (Array.isArray(parsed?.ops)) {
      const extractedText = parsed.ops.map(operation => typeof operation.insert === 'string' ? operation.insert : '').join('').trim();
      return {
        format: 'scheme-table-v1',
        school: '',
        year: String(new Date().getFullYear()),
        learningArea: '',
        grade,
        term,
        rows: extractedText ? [{ ...emptySchemeRow(), outcomes: extractedText }] : [emptySchemeRow()],
      };
    }
  } catch {
    if (content) {
      return {
        format: 'scheme-table-v1',
        school: '',
        year: String(new Date().getFullYear()),
        learningArea: '',
        grade,
        term,
        rows: [{ ...emptySchemeRow(), outcomes: content }],
      };
    }
  }
  return {
    format: 'scheme-table-v1',
    school: '',
    year: String(new Date().getFullYear()),
    learningArea: '',
    grade,
    term,
    rows: [emptySchemeRow()],
  };
};

const extractSchemeContent = async (filePath, grade, term) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.docx') {
    const result = await mammoth.convertToHtml({ path: filePath });
    const parsedTable = parseSchemeDocumentHtml(result.value);
    if (parsedTable.rows.length) {
      return JSON.stringify({
        format: 'scheme-table-v1',
        ...parsedTable,
        grade,
        term,
        year: String(new Date().getFullYear()),
      });
    }
  }
  const extractedText = await extractSchemeText(filePath);
  const fallbackTable = createSchemeTable(JSON.stringify({ ops: [{ insert: `${extractedText}\n` }] }), grade, term);
  return JSON.stringify(fallbackTable);
};

const getHomeworkFilePath = async documentPath => {
  const filename = path.basename(String(documentPath || ''));
  const privatePath = path.resolve('uploads/homework', filename);
  try {
    await fs.access(privatePath);
    return privatePath;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const legacyPath = path.resolve('public/uploads/homework', filename);
  await fs.access(legacyPath);
  return legacyPath;
};

const examSubjectDefinitions = [
  { key: 'english', label: 'English' },
  { key: 'kiswahili', label: 'Kiswahili' },
  { key: 'mathematics', label: 'Mathematics' },
  { key: 'integrated_science', label: 'Integrated Science' },
  { key: 'agriculture', label: 'Agriculture' },
  { key: 'social_studies', label: 'Social Studies' },
  { key: 'cre', label: 'CRE' },
  { key: 'pre_technical', label: 'Pre-Technical' },
  { key: 'creative_arts', label: 'Art and Craft' }
];
const examSubjectKeys = examSubjectDefinitions.map(subject => subject.key);

const canonicalSubjectCodes = {
  '101': '901',
  '102': '902',
  '103': '903',
  '105': '905',
  '106': '906',
  '107': '907',
  '108': '908',
  '111': '911',
  '112': '912',
};

const normalizeSubjectCode = code =>
  code
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getCanonicalSubjectCode = code => {
  const normalizedCode = String(code ?? '').trim();
  return canonicalSubjectCodes[normalizedCode] || normalizedCode;
};

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getSubjectDefinitionsFromDb = async () => {
  try {
    const result = await db.query(
      "SELECT DISTINCT ON (subject_code) name, subject_code::integer AS code FROM subjects WHERE subject_code ~ '^[0-9]+$' ORDER BY subject_code, id ASC",
    );
    const subjects = result.rows
      .map(row => {
        const key = normalizeSubjectCode(row.code);
        return { key, label: row.name || row.code, code: row.code };
      });
    return subjects;
  } catch (err) {
    console.error('Failed to load subjects from DB:', err.message);
    return [];
  }
};

const getSubjectDisplayLabel = (subjectValue, subjectDefinitions = []) => {
  if (!subjectValue) {
    return 'General';
  }

  const normalizedValue = normalizeSubjectCode(subjectValue);
  const match = subjectDefinitions.find(def =>
    normalizeSubjectCode(def.key) === normalizedValue ||
    normalizeSubjectCode(def.label) === normalizedValue
  );

  if (match) {
    return match.label;
  }

  return String(subjectValue)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
};

const getSubjectDefinitionsForGrade = gradeValue => {
  if (gradeValue && Number.isInteger(Number(gradeValue))) {
    return examSubjectDefinitions;
  }
  return examSubjectDefinitions;
};

export default function registerExamRoutes(app) {
  app.get('/exams', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const allSubjectDefinitions = await getSubjectDefinitionsFromDb();
    let subjectDefinitions = allSubjectDefinitions;
    let subjectKeys = allSubjectDefinitions.map(subject => subject.key);
    let learners = [];
    let normalizedGrade = null;
    if (grade) {
      normalizedGrade = grade.toString().trim();
      const result = await db.query(
        `SELECT lr.id AS result_id, lr.learner_id, lr.term,
                lr.english, lr.english_pl, lr.english_points, lr.english_cat1, lr.english_cat2, lr.english_main,
                lr.kiswahili, lr.kiswahili_pl, lr.kiswahili_points, lr.kiswahili_cat1, lr.kiswahili_cat2, lr.kiswahili_main,
                lr.mathematics, lr.mathematics_pl, lr.mathematics_points, lr.mathematics_cat1, lr.mathematics_cat2, lr.mathematics_main,
                lr.integrated_science, lr.integrated_science_pl, lr.integrated_science_points, lr.integrated_science_cat1, lr.integrated_science_cat2, lr.integrated_science_main,
                lr.agriculture, lr.agriculture_pl, lr.agriculture_points, lr.agriculture_cat1, lr.agriculture_cat2, lr.agriculture_main,
                lr.social_studies AS social_studies, lr.social_studies_pl AS social_studies_pl, lr.social_studies_points AS social_studies_points, lr.social_studies_cat1 AS social_studies_cat1, lr.social_studies_cat2 AS social_studies_cat2, lr.social_studies_main AS social_studies_main,
                lr.cre, lr.cre_pl, lr.cre_points, lr.cre_cat1, lr.cre_cat2, lr.cre_main,
                lr.pre_technical, lr.pre_technical_pl, lr.pre_technical_points, lr.pre_technical_cat1, lr.pre_technical_cat2, lr.pre_technical_main,
                lr.creative_arts, lr.creative_arts_pl, lr.creative_arts_points, lr.creative_arts_cat1, lr.creative_arts_cat2, lr.creative_arts_main,
                lr.evrg, lr.evrg_pl, lr.evrg_points,
                l.id AS learner_id, l.name, l.assessment_number, l.birth_certificate, l.class_teacher
         FROM learner_results lr
         JOIN learners l ON lr.learner_id = l.id
         WHERE (LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3))
           AND lr.term = $2 AND lr.teacher_id = $4
         ORDER BY l.name`,
        [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`, req.user.id]
      );
      learners = result.rows;

      learners.sort((a, b) => {
        const aEvrg = Number(a.evrg);
        const bEvrg = Number(b.evrg);
        if (Number.isFinite(bEvrg) && Number.isFinite(aEvrg) && bEvrg !== aEvrg) {
          return bEvrg - aEvrg;
        }
        if ((b.evrg || 0) !== (a.evrg || 0)) {
          return (b.evrg || 0) - (a.evrg || 0);
        }
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      learners.forEach((l, idx) => { l.pos = idx + 1; });
    }

    const learnerIds = learners.map(row => row.learner_id || row.id);
    const learnerSubjectMap = new Map();
    if (learnerIds.length) {
      const subjectResult = await db.query(
        `SELECT rs.learner_id, rs.subject_code, rs.subject_name, rs.final_mark, rs.pl, rs.points
         FROM learner_result_subjects rs
         JOIN learners l ON rs.learner_id = l.id
         WHERE rs.term = $1 AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
           AND rs.learner_id = ANY($4) AND rs.teacher_id = $5` ,
        [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, learnerIds, req.user.id]
      );
      subjectResult.rows.forEach(row => {
        const key = normalizeSubjectCode(row.subject_code || row.subject_name);
        const existing = learnerSubjectMap.get(row.learner_id) || {};
        existing[key] = {
          mark: row.final_mark !== null ? row.final_mark : null,
          pl: row.pl || null,
          points: row.points || null,
          label: row.subject_name || key
        };
        learnerSubjectMap.set(row.learner_id, existing);
      });
    }

    learners = learners.map(l => ({
      ...l,
      subjectRows: learnerSubjectMap.get(l.learner_id || l.id) || {}
    }));

    let submittedHomework = [];
    if (grade) {
      const homeworkRows = await db.query(
        `SELECT hs.id AS submission_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at,
                h.id AS homework_id, h.subject, h.task_description, h.document_path, h.term,
                l.id AS learner_id, l.name AS learner_name, l.assessment_number
         FROM homework_submissions hs
         JOIN homework h ON hs.homework_id = h.id
         JOIN learners l ON hs.learner_id = l.id
         WHERE h.grade = $1 AND h.term = $2 AND h.teacher_id = $3
         ORDER BY hs.submitted_at DESC`,
        [grade, selectedTerm, req.user.id]
      );
      submittedHomework = homeworkRows.rows.map(row => ({
        ...row,
        subject_name: getSubjectDisplayLabel(row.subject, subjectDefinitions)
      }));
    }

    res.render('examDashboard.ejs', {
      page: 'exams',
      selectedGrade: grade || null,
      learners,
      selectedTerm,
      submittedHomework,
      subjectDefinitions,
    });
  });

  app.get('/exams/schemes', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.query.grade || '').trim();
    const selectedTerm = ["1", "2", "3"].includes(req.query.term) ? req.query.term : "1";
    if (!/^[1-9]$/.test(grade)) return res.redirect('/exams');

    try {
      const result = await db.query(
        `SELECT id, document_path, original_filename, content, updated_at
         FROM teacher_schemes
         WHERE teacher_id = $1 AND grade = $2 AND term = $3`,
        [req.user.id, grade, selectedTerm]
      );
      const scheme = result.rows[0] || null;
      let structuredContent = false;
      if (scheme?.content) {
        try {
          structuredContent = JSON.parse(scheme.content)?.format === 'scheme-table-v1';
        } catch {
          structuredContent = false;
        }
      }
      if (scheme && !structuredContent) {
        const existingFilePath = path.resolve('uploads/schemes', path.basename(scheme.document_path));
        try {
          await fs.access(existingFilePath);
          scheme.content = await extractSchemeContent(existingFilePath, grade, selectedTerm);
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
          console.error('Scheme source file is missing; displaying saved text in the editable table.');
          scheme.content = JSON.stringify(createSchemeTable(scheme.content, grade, selectedTerm));
        }
        await db.query(
          `UPDATE teacher_schemes
           SET content = $1
           WHERE id = $2 AND teacher_id = $3`,
          [scheme.content, scheme.id, req.user.id]
        );
      }
      const schemeTable = createSchemeTable(scheme?.content, grade, selectedTerm);
      res.render('examSchemes.ejs', {
        selectedGrade: grade,
        selectedTerm,
        scheme,
        schemeTable,
        contentUnavailable: Boolean(scheme && !schemeTable.rows.some(row => Object.values(row).some(value => value.trim()))),
        uploaded: req.query.uploaded === '1',
        saved: req.query.saved === '1',
        invalid: req.query.invalid === '1',
      });
    } catch (err) {
      console.error('Failed to load scheme:', err);
      res.status(500).render('error.ejs', { message: 'Error loading scheme' });
    }
  });

  app.post('/exams/schemes', isAuthenticated, isTeacher, handleSchemeUpload, async (req, res) => {
    const grade = String(req.body.grade || '').trim();
    const term = String(req.body.term || '');
    const pageUrl = `/exams/schemes?grade=${encodeURIComponent(grade)}&term=${encodeURIComponent(term)}`;

    if (!/^[1-9]$/.test(grade) || !["1", "2", "3"].includes(term)) {
      if (req.file) await fs.unlink(req.file.path).catch(err => console.error('Failed to remove invalid scheme upload:', err));
      return res.redirect('/exams');
    }
    if (!req.file) return res.redirect(`${pageUrl}&invalid=1`);

    const documentPath = path.posix.join('uploads/schemes', req.file.filename);
    const originalFilename = path.basename(req.file.originalname).slice(0, 255);
    try {
      const content = await extractSchemeContent(req.file.path, grade, term);
      const existingResult = await db.query(
        `SELECT document_path
         FROM teacher_schemes
         WHERE teacher_id = $1 AND grade = $2 AND term = $3`,
        [req.user.id, grade, term]
      );
      await db.query(
        `INSERT INTO teacher_schemes (teacher_id, grade, term, document_path, original_filename, content)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (teacher_id, grade, term)
         DO UPDATE SET document_path = EXCLUDED.document_path,
                       original_filename = EXCLUDED.original_filename,
                       content = EXCLUDED.content,
                       updated_at = now()`,
        [req.user.id, grade, term, documentPath, originalFilename, content]
      );

      const oldPath = existingResult.rows[0]?.document_path;
      if (oldPath && oldPath !== documentPath) {
        await fs.unlink(path.resolve('uploads/schemes', path.basename(oldPath))).catch(err => {
          if (err.code !== 'ENOENT') console.error('Failed to remove replaced scheme file:', err);
        });
      }
      return res.redirect(`${pageUrl}&uploaded=1`);
    } catch (err) {
      await fs.unlink(req.file.path).catch(cleanupError => console.error('Failed to remove unsuccessful scheme upload:', cleanupError));
      console.error('Scheme upload error:', err);
      return res.status(500).render('error.ejs', { message: 'Error uploading scheme' });
    }
  });

  app.post('/exams/schemes/save', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.body.grade || '').trim();
    const term = String(req.body.term || '');
    const pageUrl = `/exams/schemes?grade=${encodeURIComponent(grade)}&term=${encodeURIComponent(term)}`;
    const content = String(req.body.content || '');

    if (!/^[1-9]$/.test(grade) || !["1", "2", "3"].includes(term)) return res.redirect('/exams');
    if (!content || content.length > 500000) return res.redirect(`${pageUrl}&invalid=1`);

    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      return res.redirect(`${pageUrl}&invalid=1`);
    }
    const maxCellLength = 10000;
    const validSchemeTable = parsedContent?.format === 'scheme-table-v1' &&
      typeof parsedContent.school === 'string' &&
      typeof parsedContent.year === 'string' &&
      typeof parsedContent.learningArea === 'string' &&
      parsedContent.school.length <= 150 &&
      parsedContent.year.length <= 20 &&
      parsedContent.learningArea.length <= 150 &&
      Array.isArray(parsedContent.rows) &&
      parsedContent.rows.length > 0 &&
      parsedContent.rows.length <= 500 &&
      parsedContent.rows.every(row =>
        row && schemeColumns.every(column =>
          typeof row[column.key] === 'string' && row[column.key].length <= maxCellLength
        )
      );
    if (!validSchemeTable) {
      return res.redirect(`${pageUrl}&invalid=1`);
    }

    try {
      const result = await db.query(
        `UPDATE teacher_schemes
         SET content = $1, updated_at = now()
         WHERE teacher_id = $2 AND grade = $3 AND term = $4
         RETURNING id`,
        [JSON.stringify({ ...parsedContent, grade, term }), req.user.id, grade, term]
      );
      if (!result.rowCount) return res.status(404).send('Upload a scheme before saving online edits.');
      return res.redirect(`${pageUrl}&saved=1`);
    } catch (err) {
      console.error('Scheme save error:', err);
      return res.status(500).render('error.ejs', { message: 'Error saving scheme edits' });
    }
  });

  app.get('/exams/schemes/download', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.query.grade || '').trim();
    const term = String(req.query.term || '');
    if (!/^[1-9]$/.test(grade) || !["1", "2", "3"].includes(term)) return res.status(404).send('Scheme not found.');

    try {
      const result = await db.query(
        `SELECT document_path, original_filename
         FROM teacher_schemes
         WHERE teacher_id = $1 AND grade = $2 AND term = $3`,
        [req.user.id, grade, term]
      );
      const scheme = result.rows[0];
      if (!scheme) return res.status(404).send('Scheme not found.');
      return res.download(path.resolve('uploads/schemes', path.basename(scheme.document_path)), scheme.original_filename);
    } catch (err) {
      console.error('Scheme download error:', err);
      return res.status(500).send('Error downloading scheme.');
    }
  });

  app.get('/exams/notes', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.query.grade || '').trim();
    const selectedTerm = ["1", "2", "3"].includes(req.query.term) ? req.query.term : "1";
    if (!/^[1-9]$/.test(grade)) return res.redirect('/exams');

    const [subjectResult, notesResult] = await Promise.all([
      db.query(
        `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(subject_code), ''), name))
                name, COALESCE(NULLIF(BTRIM(subject_code), ''), name) AS subject_code
         FROM subjects
         WHERE name IS NOT NULL AND BTRIM(name) <> ''
         ORDER BY COALESCE(NULLIF(BTRIM(subject_code), ''), name), id ASC`
      ),
      db.query(
        `SELECT id, subject_code, subject_name, content, week_no, lesson_no, strand, sub_strand, updated_at
         FROM teacher_notes
         WHERE teacher_id = $1 AND grade = $2 AND term = $3
         ORDER BY subject_name, week_no NULLS LAST, lesson_no NULLS LAST, created_at, id`,
        [req.user.id, grade, selectedTerm]
      ),
    ]);
    const selectedSubjectCode = String(req.query.subject_code || '');
    const selectedArea = subjectResult.rows.find(area => area.subject_code === selectedSubjectCode) || null;
    const notes = selectedArea ? notesResult.rows.filter(note => note.subject_code === selectedSubjectCode) : [];
    const formatNote = note => {
      let editorContent;
      try {
        editorContent = JSON.parse(note.content);
      } catch {
        editorContent = { ops: [{ insert: `${note.content}\n` }] };
      }
      const hasDelta = editorContent && Array.isArray(editorContent.ops);
      const plainContent = hasDelta
        ? editorContent.ops.map(operation => typeof operation.insert === 'string' ? operation.insert : '').join('').trim()
        : String(note.content || '').trim();
      const characters = Array.from(plainContent);
      return {
        ...note,
        editorContent: hasDelta ? editorContent : { ops: [{ insert: `${note.content}\n` }] },
        previewText: characters.length > 20 ? `${characters.slice(0, 20).join('')}...` : plainContent,
      };
    };
    const formattedNotes = notes.map(formatNote);
    const editNote = formattedNotes.find(note => String(note.id) === String(req.query.edit_id)) || null;
    if (req.query.edit_id && !editNote) return res.redirect('/login');

    res.render('examNotes.ejs', {
      selectedGrade: grade,
      selectedTerm,
      learningAreas: subjectResult.rows,
      selectedSubjectCode: selectedArea ? selectedSubjectCode : '',
      selectedArea,
      notes: formattedNotes,
      editNote: editNote && editNote.subject_code === selectedSubjectCode ? editNote : null,
      saved: req.query.saved === '1',
      updated: req.query.updated === '1',
      deleted: req.query.deleted === '1',
      invalid: req.query.invalid === '1',
    });
  });

  app.post('/exams/notes', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.body.grade || '').trim();
    const selectedTerm = String(req.body.term || '');
    const subjectCode = String(req.body.subject_code || '').trim();
    const content = String(req.body.content || '').trim();
    const weekNo = Number(req.body.week_no);
    const lessonNo = Number(req.body.lesson_no);
    const strand = String(req.body.strand || '').trim();
    const subStrand = String(req.body.sub_strand || '').trim();
    const noteId = String(req.body.note_id || '').trim();
    const pageUrl = `/exams/notes?grade=${encodeURIComponent(grade)}&term=${encodeURIComponent(selectedTerm)}&subject_code=${encodeURIComponent(subjectCode)}`;
    const editQuery = noteId ? `&edit_id=${encodeURIComponent(noteId)}` : '';

    if (!/^[1-9]$/.test(grade) || !["1", "2", "3"].includes(selectedTerm)) return res.redirect('/exams');
    if (!subjectCode || !Number.isInteger(weekNo) || weekNo < 1 || !Number.isInteger(lessonNo) || lessonNo < 1 || !strand || strand.length > 255 || !subStrand || subStrand.length > 255 || !content || content.length > 100000) {
      return res.redirect(`${pageUrl}${editQuery}&invalid=1`);
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      return res.redirect(`${pageUrl}${editQuery}&invalid=1`);
    }
    if (!parsedContent || !Array.isArray(parsedContent.ops)) {
      return res.redirect(`${pageUrl}${editQuery}&invalid=1`);
    }

    const subjectResult = await db.query(
      `SELECT name, COALESCE(NULLIF(BTRIM(subject_code), ''), name) AS subject_code
       FROM subjects
       WHERE COALESCE(NULLIF(BTRIM(subject_code), ''), name) = $1
       ORDER BY id ASC
       LIMIT 1`,
      [subjectCode]
    );
    const subject = subjectResult.rows[0];
    if (!subject) return res.redirect('/exams');

    const title = `Week ${weekNo} Lesson ${lessonNo}`;
    if (noteId) {
      if (!/^\d+$/.test(noteId)) return res.redirect(`${pageUrl}&invalid=1`);
      const result = await db.query(
        `UPDATE teacher_notes
         SET subject_code = $1, subject_name = $2, title = $3, content = $4,
             week_no = $5, lesson_no = $6, strand = $7, sub_strand = $8, updated_at = now()
         WHERE id = $9 AND teacher_id = $10 AND grade = $11 AND term = $12
         RETURNING id`,
        [subject.subject_code, subject.name, title, JSON.stringify(parsedContent), weekNo, lessonNo, strand, subStrand, noteId, req.user.id, grade, selectedTerm]
      );
      if (!result.rowCount) return res.redirect('/login');
      return res.redirect(`${pageUrl}&updated=1`);
    }

    await db.query(
      `INSERT INTO teacher_notes (
         teacher_id, grade, term, subject_code, subject_name, title, content, week_no, lesson_no, strand, sub_strand
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [req.user.id, grade, selectedTerm, subject.subject_code, subject.name, title, JSON.stringify(parsedContent), weekNo, lessonNo, strand, subStrand]
    );
    res.redirect(`${pageUrl}&saved=1`);
  });

  app.post('/exams/notes/:id/delete', isAuthenticated, isTeacher, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) return res.redirect('/login');
    const result = await db.query(
      `DELETE FROM teacher_notes
       WHERE id = $1 AND teacher_id = $2
       RETURNING grade, term, subject_code`,
      [req.params.id, req.user.id]
    );
    const note = result.rows[0];
    if (!note) return res.redirect('/login');
    const pageUrl = `/exams/notes?grade=${encodeURIComponent(note.grade)}&term=${encodeURIComponent(note.term)}&subject_code=${encodeURIComponent(note.subject_code)}`;
    res.redirect(`${pageUrl}&deleted=1`);
  });

  app.get('/exams/notes/:id/download', isAuthenticated, isTeacher, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) return res.redirect('/login');
    const result = await db.query(
      `SELECT id, grade, term, subject_name, content, week_no, lesson_no, strand, sub_strand
       FROM teacher_notes
       WHERE id = $1 AND teacher_id = $2`,
      [req.params.id, req.user.id]
    );
    const note = result.rows[0];
    if (!note) return res.redirect('/login');

    const subjectSlug = String(note.subject_name || 'learning-area')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="notes-grade-${note.grade}-${subjectSlug}-term-${note.term}.doc"`);
    res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(note.subject_name)} Notes</title>
<style>body{font-family:Calibri,Arial,sans-serif;line-height:1.5;margin:2cm;color:#222}h1{font-size:22pt}h2{font-size:16pt}</style>
</head><body><h1>${escapeHtml(note.subject_name)} Notes</h1>
<p><strong>Grade:</strong> ${escapeHtml(note.grade)} &nbsp; <strong>Term:</strong> ${escapeHtml(note.term)} &nbsp; <strong>Week:</strong> ${escapeHtml(note.week_no)} &nbsp; <strong>Lesson:</strong> ${escapeHtml(note.lesson_no)}</p>
<p><strong>Strand:</strong> ${escapeHtml(note.strand)}<br><strong>Sub-strand:</strong> ${escapeHtml(note.sub_strand)}</p>
<hr>${lessonNoteContentHtml(note.content)}</body></html>`);
  });

  app.get('/exams/learning-areas', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.query.grade || '').trim();
    const selectedTerm = ["1", "2", "3"].includes(req.query.term) ? req.query.term : "1";
    if (!/^[1-9]$/.test(grade)) {
      return res.redirect('/exams');
    }

    const result = await db.query(
      `SELECT DISTINCT ON (COALESCE(NULLIF(BTRIM(subject_code), ''), name))
              name, COALESCE(NULLIF(BTRIM(subject_code), ''), name) AS subject_code
       FROM subjects
       WHERE name IS NOT NULL AND BTRIM(name) <> ''
       ORDER BY COALESCE(NULLIF(BTRIM(subject_code), ''), name), id ASC`
    );
    const selectedSubjectCode = String(req.query.subject_code || '');
    const selectedArea = result.rows.find(area => area.subject_code === selectedSubjectCode) || null;
    const noteResult = selectedArea
      ? await db.query(
        `SELECT id, strand, sub_strand, week_no, lesson_no, lesson_content,
                school_name, roll, TO_CHAR(lesson_time, 'HH24:MI') AS lesson_time
         FROM lesson_notes
         WHERE teacher_id = $1 AND grade = $2 AND term = $3 AND subject_code = $4
         ORDER BY lesson_no, created_at, id`,
        [req.user.id, grade, selectedTerm, selectedSubjectCode]
      )
      : { rows: [] };
    const editNote = noteResult.rows.find(note => String(note.id) === String(req.query.edit_id)) || null;
    if (req.query.edit_id && !editNote) return res.redirect('/login');
    if (req.query.edit_id && !editNote) return res.redirect('/login');

    res.render('examLearningAreas.ejs', {
      selectedGrade: grade,
      selectedTerm,
      learningAreas: result.rows,
      selectedSubjectCode: selectedArea ? selectedSubjectCode : '',
      selectedArea,
      lessonNotes: noteResult.rows,
      editNote,
      saved: req.query.saved === '1',
      updated: req.query.updated === '1',
      deleted: req.query.deleted === '1',
      invalid: req.query.invalid === '1',
    });
  });

  app.post('/exams/learning-areas', isAuthenticated, isTeacher, async (req, res) => {
    const grade = String(req.body.grade || '').trim();
    const selectedTerm = String(req.body.term || '');
    const subjectCode = String(req.body.subject_code || '').trim();
    const schoolName = String(req.body.school_name || '').trim();
    const roll = String(req.body.roll || '').trim();
    const lessonTime = String(req.body.lesson_time || '').trim();
    const strand = String(req.body.strand || '').trim();
    const subStrand = String(req.body.sub_strand || '').trim();
    const weekNo = Number(req.body.week_no);
    const lessonNo = Number(req.body.lesson_no);
    const lessonContent = String(req.body.lesson_content || '');
    const lessonNoteId = String(req.body.lesson_note_id || '').trim();
    const pageUrl = `/exams/learning-areas?grade=${encodeURIComponent(grade)}&term=${encodeURIComponent(selectedTerm)}&subject_code=${encodeURIComponent(subjectCode)}`;
    const editQuery = lessonNoteId ? `&edit_id=${encodeURIComponent(lessonNoteId)}` : '';

    if (!/^[1-9]$/.test(grade) || !["1", "2", "3"].includes(selectedTerm)) {
      return res.redirect('/exams');
    }
    if (!subjectCode || !schoolName || schoolName.length > 150 || !roll || roll.length > 50 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(lessonTime) || !strand || !subStrand || !Number.isInteger(weekNo) || weekNo < 1 || !Number.isInteger(lessonNo) || lessonNo < 1 || lessonContent.length > 100000) {
      return res.redirect(`${pageUrl}${editQuery}&invalid=1`);
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(lessonContent);
    } catch {
      return res.redirect(`${pageUrl}${editQuery}&invalid=1`);
    }
    if (!parsedContent || !Array.isArray(parsedContent.ops)) {
      return res.redirect(`${pageUrl}${editQuery}&invalid=1`);
    }

    const subjectResult = await db.query(
      `SELECT name, COALESCE(NULLIF(BTRIM(subject_code), ''), name) AS subject_code
       FROM subjects
       WHERE COALESCE(NULLIF(BTRIM(subject_code), ''), name) = $1
       ORDER BY id ASC
       LIMIT 1`,
      [subjectCode]
    );
    const subject = subjectResult.rows[0];
    if (!subject) {
      return res.redirect('/exams');
    }

    if (lessonNoteId) {
      if (!/^\d+$/.test(lessonNoteId)) return res.redirect(`${pageUrl}&invalid=1`);
      const updateResult = await db.query(
        `UPDATE lesson_notes
         SET subject_code = $1, subject_name = $2, strand = $3, sub_strand = $4,
             week_no = $5, lesson_no = $6, lesson_content = $7, school_name = $8,
             roll = $9, lesson_time = $10, updated_at = now()
         WHERE id = $11 AND teacher_id = $12 AND grade = $13 AND term = $14
         RETURNING id`,
        [subject.subject_code, subject.name, strand, subStrand, weekNo, lessonNo, JSON.stringify(parsedContent), schoolName, roll, lessonTime, lessonNoteId, req.user.id, grade, selectedTerm]
      );
      if (!updateResult.rowCount) return res.redirect('/login');
      return res.redirect(`${pageUrl}&updated=1`);
    }

    await db.query(
      `INSERT INTO lesson_notes (
        teacher_id, grade, term, subject_code, subject_name,
        strand, sub_strand, week_no, lesson_no, lesson_content,
        school_name, roll, lesson_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [req.user.id, grade, selectedTerm, subject.subject_code, subject.name, strand, subStrand, weekNo, lessonNo, JSON.stringify(parsedContent), schoolName, roll, lessonTime]
    );

    res.redirect(`${pageUrl}&saved=1`);
  });

  app.post('/exams/lesson-notes/:id/delete', isAuthenticated, isTeacher, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) return res.redirect('/login');
    const result = await db.query(
      `DELETE FROM lesson_notes
       WHERE id = $1 AND teacher_id = $2
       RETURNING grade, term, subject_code`,
      [req.params.id, req.user.id]
    );
    const note = result.rows[0];
    if (!note) return res.redirect('/login');
    const pageUrl = `/exams/learning-areas?grade=${encodeURIComponent(note.grade)}&term=${encodeURIComponent(note.term)}&subject_code=${encodeURIComponent(note.subject_code)}`;
    res.redirect(`${pageUrl}&deleted=1`);
  });

  app.get('/exams/lesson-notes/:id/download', isAuthenticated, isTeacher, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.id))) return res.redirect('/login');
    const result = await db.query(
      `SELECT id, grade, term, subject_name, strand, sub_strand, week_no, lesson_no, lesson_content,
              school_name, roll, TO_CHAR(lesson_time, 'HH24:MI') AS lesson_time
       FROM lesson_notes
       WHERE id = $1 AND teacher_id = $2`,
      [req.params.id, req.user.id]
    );
    const note = result.rows[0];
    if (!note) return res.redirect('/login');

    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${lessonNoteFilename(note)}"`);
    res.send(lessonNoteDocumentHtml(note));
  });

  app.get('/exams/add', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term, learner_id, assessment } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const selectedLearnerId = learner_id || null;
    const selectedAssessmentType = assessment === 'summative' ? 'summative' : 'continous';
    let result;
    if (grade) {
      const normalizedGrade = grade.toString().trim();
      result = await db.query(
        `SELECT l.*, lr.id AS result_id, lr.term,
                lr.english, lr.english_pl, lr.english_points, lr.english_cat1, lr.english_cat2, lr.english_main,
                lr.kiswahili, lr.kiswahili_pl, lr.kiswahili_points, lr.kiswahili_cat1, lr.kiswahili_cat2, lr.kiswahili_main,
                lr.mathematics, lr.mathematics_pl, lr.mathematics_points, lr.mathematics_cat1, lr.mathematics_cat2, lr.mathematics_main,
                lr.integrated_science, lr.integrated_science_pl, lr.integrated_science_points, lr.integrated_science_cat1, lr.integrated_science_cat2, lr.integrated_science_main,
                lr.agriculture, lr.agriculture_pl, lr.agriculture_points, lr.agriculture_cat1, lr.agriculture_cat2, lr.agriculture_main,
                lr.social_studies AS social_studies, lr.social_studies_pl AS social_studies_pl, lr.social_studies_points AS social_studies_points, lr.social_studies_cat1 AS social_studies_cat1, lr.social_studies_cat2 AS social_studies_cat2, lr.social_studies_main AS social_studies_main,
                lr.cre, lr.cre_pl, lr.cre_points, lr.cre_cat1, lr.cre_cat2, lr.cre_main,
                lr.pre_technical, lr.pre_technical_pl, lr.pre_technical_points, lr.pre_technical_cat1, lr.pre_technical_cat2, lr.pre_technical_main,
                lr.creative_arts, lr.creative_arts_pl, lr.creative_arts_points, lr.creative_arts_cat1, lr.creative_arts_cat2, lr.creative_arts_main,
                lr.evrg, lr.evrg_pl, lr.evrg_points
         FROM learners l
         LEFT JOIN learner_results lr ON lr.learner_id = l.id AND lr.term = $2 AND lr.teacher_id = $4
         WHERE LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3)
         ORDER BY l.name`,
        [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`, req.user.id]
      );
    } else {
      result = await db.query(
        `SELECT l.*, lr.id AS result_id, lr.term,
                lr.english, lr.english_pl, lr.english_points, lr.english_cat1, lr.english_cat2, lr.english_main,
                lr.kiswahili, lr.kiswahili_pl, lr.kiswahili_points, lr.kiswahili_cat1, lr.kiswahili_cat2, lr.kiswahili_main,
                lr.mathematics, lr.mathematics_pl, lr.mathematics_points, lr.mathematics_cat1, lr.mathematics_cat2, lr.mathematics_main,
                lr.integrated_science, lr.integrated_science_pl, lr.integrated_science_points, lr.integrated_science_cat1, lr.integrated_science_cat2, lr.integrated_science_main,
                lr.agriculture, lr.agriculture_pl, lr.agriculture_points, lr.agriculture_cat1, lr.agriculture_cat2, lr.agriculture_main,
                lr.social_studies AS social_studies, lr.social_studies_pl AS social_studies_pl, lr.social_studies_points AS social_studies_points, lr.social_studies_cat1 AS social_studies_cat1, lr.social_studies_cat2 AS social_studies_cat2, lr.social_studies_main AS social_studies_main,
                lr.cre, lr.cre_pl, lr.cre_points, lr.cre_cat1, lr.cre_cat2, lr.cre_main,
                lr.pre_technical, lr.pre_technical_pl, lr.pre_technical_points, lr.pre_technical_cat1, lr.pre_technical_cat2, lr.pre_technical_main,
                lr.creative_arts, lr.creative_arts_pl, lr.creative_arts_points, lr.creative_arts_cat1, lr.creative_arts_cat2, lr.creative_arts_main,
                lr.evrg, lr.evrg_pl, lr.evrg_points
         FROM learners l
         LEFT JOIN learner_results lr ON lr.learner_id = l.id AND lr.term = $1 AND lr.teacher_id = $2
         ORDER BY l.grade, l.name`,
        [selectedTerm, req.user.id]
      );
    }
    const learnerIds = result.rows.map(row => row.id);
    let subjectRowMap = new Map();
    if (learnerIds.length) {
      const subjectResult = await db.query(
        `SELECT learner_id, subject_code, subject_name, cat1, cat2, main,
                ee, ae, me, be, strand, sub_strand, reflection
         FROM learner_result_subjects
         WHERE term = $1 AND learner_id = ANY($2) AND teacher_id = $3`,
        [selectedTerm, learnerIds, req.user.id]
      );
      subjectResult.rows.forEach(row => {
        const code = normalizeSubjectCode(row.subject_code || row.subject_name || '');
        const existing = subjectRowMap.get(row.learner_id) || {};
        existing[code] = {
          cat1: row.cat1 || '',
          cat2: row.cat2 || '',
          main: row.main || '',
          ee: row.ee || null,
          ae: row.ae || null,
          me: row.me || null,
          be: row.be || null,
          strand: row.strand || null,
          sub_strand: row.sub_strand || null,
          reflection: row.reflection || null,
          subject_name: row.subject_name || row.subject_code || ''
        };
        subjectRowMap.set(row.learner_id, existing);
      });
    }
    const dbSubjectDefinitions = await getSubjectDefinitionsFromDb();
    const learnersWithSubjects = result.rows.map(row => ({
      ...row,
      subjectRows: subjectRowMap.get(row.id) || {}
    }));
    res.render('addExam.ejs', {
      grade: grade || null,
      selectedTerm,
      learners: learnersWithSubjects,
      selectedLearnerId,
      subjectDefinitions: dbSubjectDefinitions,
      assessmentType: selectedAssessmentType,
    });
  });

  app.post('/exams/add', isAuthenticated, isTeacher, async (req, res) => {
    const { learner_id, term, grade, selected_subjects, assessment_type } = req.body;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const selectedGrade = grade || null;
    const assessmentType = assessment_type === 'summative' ? 'summative' : 'continous';
    const isContinuousAssessment = assessmentType === 'continous';
    const dbSubjects = await getSubjectDefinitionsFromDb();
    const subjectKeys = dbSubjects.map(subject => subject.key);
    const fixedSubjectKeys = examSubjectKeys;

    const requestedSubjects = Array.isArray(selected_subjects)
      ? selected_subjects.map(String).map(s => s.trim()).filter(Boolean)
      : (selected_subjects || '').split(',').map(s => s.trim()).filter(Boolean);

    const subjectRows = await db.query("SELECT name, subject_code AS code FROM subjects");
    const subjectMap = new Map(subjectRows.rows.map(row => {
      const key = normalizeSubjectCode(row.code || row.name);
      return [key, row.name];
    }));

    const postedSubjects = subjectKeys.filter(key => {
      return [
        req.body[`${key}_cat1`],
        req.body[`${key}_cat2`],
        req.body[`${key}_main`]
      ].some(value => value !== undefined && value !== null && String(value).trim() !== '');
    });

    const activeSubjects = Array.from(new Set([
      ...requestedSubjects,
      ...postedSubjects
    ]));

    if (isContinuousAssessment) {
      if (activeSubjects.length > 0) {
        await db.query(
          `DELETE FROM learner_result_subjects
           WHERE learner_id = $1 AND term = $2 AND teacher_id = $3 AND subject_code <> ALL($4::text[])`,
          [learner_id, selectedTerm, req.user.id, activeSubjects],
        );
      } else {
        await db.query(
          `DELETE FROM learner_result_subjects
           WHERE learner_id = $1 AND term = $2 AND teacher_id = $3`,
          [learner_id, selectedTerm, req.user.id],
        );
      }
    }

    const parseRawMark = value => {
      if (value === '' || value === null || value === undefined) return null;
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (n < 0) return 0;
      if (n > 100) return 100;
      return n;
    };

    const convertExamMark = (cat1, cat2, main) => {
      if (cat1 === null && cat2 === null && main === null) return null;
      const scoreCat1 = cat1 || 0;
      const scoreCat2 = cat2 || 0;
      const scoreMain = main || 0;
      return Math.round((scoreCat1 / 100 * 15) + (scoreCat2 / 100 * 15) + (scoreMain / 100 * 70));
    };

    let existingTermResult = {};
    try {
      const r = await db.query(
        'SELECT * FROM learner_results WHERE learner_id = $1 AND term = $2 AND teacher_id = $3 LIMIT 1',
        [learner_id, selectedTerm, req.user.id]
      );
      existingTermResult = r.rows[0] || {};
    } catch (err) {
      console.error('Error fetching existing term result', err);
      return res.render('error.ejs', { message: 'Error fetching learner result' });
    }

    const g = {};
    for (const key of subjectKeys) {
      const isActive = activeSubjects.includes(key);
      if (!isActive) {
        g[`${key}_cat1`] = null;
        g[`${key}_cat2`] = null;
        g[`${key}_main`] = null;
        g[key] = null;
        g[`${key}_pl`] = null;
        g[`${key}_points`] = null;
        continue;
      }

      const providedCat1 = parseRawMark(req.body[`${key}_cat1`]);
      const providedCat2 = parseRawMark(req.body[`${key}_cat2`]);
      const providedMain = parseRawMark(req.body[`${key}_main`]);

      const existingCat1 = existingTermResult[`${key}_cat1`] ? Number(existingTermResult[`${key}_cat1`]) : null;
      const existingCat2 = existingTermResult[`${key}_cat2`] ? Number(existingTermResult[`${key}_cat2`]) : null;
      const existingMain = existingTermResult[`${key}_main`] ? Number(existingTermResult[`${key}_main`]) : null;

      const cat1 = providedCat1 !== null ? providedCat1 : existingCat1;
      const cat2 = providedCat2 !== null ? providedCat2 : existingCat2;
      const main = providedMain !== null ? providedMain : existingMain;

      const finalMark = convertExamMark(cat1, cat2, main);
      const { pl, points } = getGradeAndPoints(finalMark);

      g[`${key}_cat1`] = cat1 !== null ? String(cat1) : null;
      g[`${key}_cat2`] = cat2 !== null ? String(cat2) : null;
      g[`${key}_main`] = main !== null ? String(main) : null;
      g[key] = finalMark !== null ? finalMark : null;
      g[`${key}_pl`] = pl;
      g[`${key}_points`] = points;
    }

    const numericMarks = subjectKeys.map(k => (activeSubjects.includes(k) && typeof g[k] === 'number' ? g[k] : NaN));
    const validMarks = numericMarks.filter(Number.isFinite);
    const evrg = validMarks.length > 0
      ? Math.round(validMarks.reduce((sum, n) => sum + n, 0) / validMarks.length)
      : null;

    const { pl: evrg_pl, points: evrg_points } = getGradeAndPoints(evrg);
    g.evrg = evrg;
    g.evrg_pl = evrg_pl;
    g.evrg_points = evrg_points;

    try {
      await db.query(
        `INSERT INTO learner_results (
          learner_id, term, teacher_id,
          english_cat1, english_cat2, english_main, english, english_pl, english_points,
          kiswahili_cat1, kiswahili_cat2, kiswahili_main, kiswahili, kiswahili_pl, kiswahili_points,
          mathematics_cat1, mathematics_cat2, mathematics_main, mathematics, mathematics_pl, mathematics_points,
          integrated_science_cat1, integrated_science_cat2, integrated_science_main, integrated_science, integrated_science_pl, integrated_science_points,
          agriculture_cat1, agriculture_cat2, agriculture_main, agriculture, agriculture_pl, agriculture_points,
          social_studies_cat1, social_studies_cat2, social_studies_main, social_studies, social_studies_pl, social_studies_points,
          cre_cat1, cre_cat2, cre_main, cre, cre_pl, cre_points,
          pre_technical_cat1, pre_technical_cat2, pre_technical_main, pre_technical, pre_technical_pl, pre_technical_points,
          creative_arts_cat1, creative_arts_cat2, creative_arts_main, creative_arts, creative_arts_pl, creative_arts_points,
          evrg, evrg_pl, evrg_points
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27,
          $28, $29, $30, $31, $32, $33,
          $34, $35, $36, $37, $38, $39,
          $40, $41, $42, $43, $44, $45,
          $46, $47, $48, $49, $50, $51,
          $52, $53, $54, $55, $56, $57,
          $58, $59, $60
        )
        ON CONFLICT (learner_id, term, teacher_id) DO UPDATE SET
          english_cat1 = EXCLUDED.english_cat1,
          english_cat2 = EXCLUDED.english_cat2,
          english_main = EXCLUDED.english_main,
          english = EXCLUDED.english,
          english_pl = EXCLUDED.english_pl,
          english_points = EXCLUDED.english_points,
          kiswahili_cat1 = EXCLUDED.kiswahili_cat1,
          kiswahili_cat2 = EXCLUDED.kiswahili_cat2,
          kiswahili_main = EXCLUDED.kiswahili_main,
          kiswahili = EXCLUDED.kiswahili,
          kiswahili_pl = EXCLUDED.kiswahili_pl,
          kiswahili_points = EXCLUDED.kiswahili_points,
          mathematics_cat1 = EXCLUDED.mathematics_cat1,
          mathematics_cat2 = EXCLUDED.mathematics_cat2,
          mathematics_main = EXCLUDED.mathematics_main,
          mathematics = EXCLUDED.mathematics,
          mathematics_pl = EXCLUDED.mathematics_pl,
          mathematics_points = EXCLUDED.mathematics_points,
          integrated_science_cat1 = EXCLUDED.integrated_science_cat1,
          integrated_science_cat2 = EXCLUDED.integrated_science_cat2,
          integrated_science_main = EXCLUDED.integrated_science_main,
          integrated_science = EXCLUDED.integrated_science,
          integrated_science_pl = EXCLUDED.integrated_science_pl,
          integrated_science_points = EXCLUDED.integrated_science_points,
          agriculture_cat1 = EXCLUDED.agriculture_cat1,
          agriculture_cat2 = EXCLUDED.agriculture_cat2,
          agriculture_main = EXCLUDED.agriculture_main,
          agriculture = EXCLUDED.agriculture,
          agriculture_pl = EXCLUDED.agriculture_pl,
          agriculture_points = EXCLUDED.agriculture_points,
          social_studies_cat1 = EXCLUDED.social_studies_cat1,
          social_studies_cat2 = EXCLUDED.social_studies_cat2,
          social_studies_main = EXCLUDED.social_studies_main,
          social_studies = EXCLUDED.social_studies,
          social_studies_pl = EXCLUDED.social_studies_pl,
          social_studies_points = EXCLUDED.social_studies_points,
          cre_cat1 = EXCLUDED.cre_cat1,
          cre_cat2 = EXCLUDED.cre_cat2,
          cre_main = EXCLUDED.cre_main,
          cre = EXCLUDED.cre,
          cre_pl = EXCLUDED.cre_pl,
          cre_points = EXCLUDED.cre_points,
          pre_technical_cat1 = EXCLUDED.pre_technical_cat1,
          pre_technical_cat2 = EXCLUDED.pre_technical_cat2,
          pre_technical_main = EXCLUDED.pre_technical_main,
          pre_technical = EXCLUDED.pre_technical,
          pre_technical_pl = EXCLUDED.pre_technical_pl,
          pre_technical_points = EXCLUDED.pre_technical_points,
          creative_arts_cat1 = EXCLUDED.creative_arts_cat1,
          creative_arts_cat2 = EXCLUDED.creative_arts_cat2,
          creative_arts_main = EXCLUDED.creative_arts_main,
          creative_arts = EXCLUDED.creative_arts,
          creative_arts_pl = EXCLUDED.creative_arts_pl,
          creative_arts_points = EXCLUDED.creative_arts_points,
          evrg = EXCLUDED.evrg,
          evrg_pl = EXCLUDED.evrg_pl,
          evrg_points = EXCLUDED.evrg_points
        `,
        [
          learner_id, selectedTerm, req.user.id,
          g.english_cat1, g.english_cat2, g.english_main, g.english, g.english_pl, g.english_points,
          g.kiswahili_cat1, g.kiswahili_cat2, g.kiswahili_main, g.kiswahili, g.kiswahili_pl, g.kiswahili_points,
          g.mathematics_cat1, g.mathematics_cat2, g.mathematics_main, g.mathematics, g.mathematics_pl, g.mathematics_points,
          g.integrated_science_cat1, g.integrated_science_cat2, g.integrated_science_main, g.integrated_science, g.integrated_science_pl, g.integrated_science_points,
          g.agriculture_cat1, g.agriculture_cat2, g.agriculture_main, g.agriculture, g.agriculture_pl, g.agriculture_points,
          g.social_studies_cat1, g.social_studies_cat2, g.social_studies_main, g.social_studies, g.social_studies_pl, g.social_studies_points,
          g.cre_cat1, g.cre_cat2, g.cre_main, g.cre, g.cre_pl, g.cre_points,
          g.pre_technical_cat1, g.pre_technical_cat2, g.pre_technical_main, g.pre_technical, g.pre_technical_pl, g.pre_technical_points,
          g.creative_arts_cat1, g.creative_arts_cat2, g.creative_arts_main, g.creative_arts, g.creative_arts_pl, g.creative_arts_points,
          g.evrg, g.evrg_pl, g.evrg_points
        ]
      );

      for (const subject of activeSubjects) {
        const cat1 = parseRawMark(req.body[`${subject}_cat1`]);
        const cat2 = parseRawMark(req.body[`${subject}_cat2`]);
        const main = parseRawMark(req.body[`${subject}_main`]);
        const finalMark = convertExamMark(cat1, cat2, main);
        const { pl, points } = getGradeAndPoints(finalMark);

        const entryIndexes = [...new Set(
          Object.keys(req.body)
            .map(name => name.match(new RegExp(`^${subject}_line_(\\d+)_`)))
            .filter(Boolean)
            .map(match => Number(match[1]))
        )].sort((a, b) => a - b);

        // Store one aligned value per substrand so the learner view can display each entry.
        const entryValues = type => entryIndexes.map(index =>
          req.body[`${subject}_line_${index}_${type}`] ? '1' : ''
        ).join('\n');
        const ee = entryIndexes.length ? entryValues('ee') : null;
        const ae = entryIndexes.length ? entryValues('ae') : null;
        const me = entryIndexes.length ? entryValues('me') : null;
        const be = entryIndexes.length ? entryValues('be') : null;

        const strandInput = req.body[`${subject}_strand`];
        const strandValues = Array.isArray(strandInput)
          ? strandInput.map(value => String(value || '').trim()).filter(Boolean)
          : (strandInput ? [String(strandInput).trim()] : []);
        const strand = strandValues.length ? strandValues.join('\n') : null;

        // collect substrand texts saved as <subject>_line_N_text inputs
        const substrandKeys = Object.keys(req.body).filter(k => k.startsWith(`${subject}_line_`) && k.endsWith('_text'));
        const substrandValues = substrandKeys.map(k => String(req.body[k] || '').trim()).filter(v => v !== '');
        const subStrand = substrandValues.length ? substrandValues.join('\n') : (req.body[`${subject}_sub_strand`] ? String(req.body[`${subject}_sub_strand`]).trim() : null);
        const lessonTitle = substrandValues.length ? substrandValues[0] : (req.body[`${subject}_sub_strand`] ? String(req.body[`${subject}_sub_strand`]).trim() : null);

        // collect reflection texts saved as <subject>_line_N_reflection inputs
        const reflectionKeys = Object.keys(req.body).filter(k => k.startsWith(`${subject}_line_`) && k.endsWith('_reflection'));
        const reflectionValues = entryIndexes.map(index =>
          String(req.body[`${subject}_line_${index}_reflection`] || '').trim()
        );
        let reflection = null;
        if (reflectionValues.length) {
          reflection = reflectionValues.join('\n');
        } else if (req.body[`${subject}_reflection`]) {
          const raw = req.body[`${subject}_reflection`];
          if (Array.isArray(raw)) reflection = raw.map(v => String(v || '').trim()).filter(Boolean).join('\n');
          else reflection = String(raw || '').trim() || null;
        }

        const subjectName = subjectMap.get(subject) || subject;

        await db.query(
          `INSERT INTO learner_result_subjects (
            learner_id, term, teacher_id, subject_code, subject_name,
            cat1, cat2, main, final_mark, pl, points,
            ee, ae, me, be, strand, sub_strand, lesson_title, reflection
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (learner_id, term, subject_code, teacher_id) DO UPDATE SET
            subject_name = EXCLUDED.subject_name,
            cat1 = EXCLUDED.cat1,
            cat2 = EXCLUDED.cat2,
            main = EXCLUDED.main,
            final_mark = EXCLUDED.final_mark,
            pl = EXCLUDED.pl,
            points = EXCLUDED.points,
            ee = EXCLUDED.ee,
            ae = EXCLUDED.ae,
            me = EXCLUDED.me,
            be = EXCLUDED.be,
            strand = EXCLUDED.strand,
            sub_strand = EXCLUDED.sub_strand,
            lesson_title = EXCLUDED.lesson_title,
            reflection = EXCLUDED.reflection,
            updated_at = NOW()
          `,
          [
            learner_id, selectedTerm, req.user.id, subject, subjectName,
            cat1 !== null ? String(cat1) : null,
            cat2 !== null ? String(cat2) : null,
            main !== null ? String(main) : null,
            finalMark !== null ? String(finalMark) : null,
            pl, points,
            ee, ae, me, be,
            strand, subStrand, lessonTitle, reflection
          ]
        );
      }

      const learnerResult = await db.query('SELECT grade FROM learners WHERE id=$1', [learner_id]);
      const gradeVal = learnerResult.rows[0]?.grade;
      res.redirect(`/exams?grade=${gradeVal}&term=${selectedTerm}`);
    } catch (err) {
      console.error(err);
      res.render('error.ejs', { message: 'Error adding exam result' });
    }
  });

  // Edit exam result
  app.get('/exams/:id/edit', isAuthenticated, isTeacher, async (req, res) => {
    const { id } = req.params;
    const { grade, term } = req.query;
    const result = await db.query(
      `SELECT lr.*, l.name, l.assessment_number, l.birth_certificate, l.grade AS learner_grade, l.class_teacher
       FROM learner_results lr
       JOIN learners l ON lr.learner_id = l.id
       WHERE lr.id = $1 AND lr.teacher_id = $2`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.redirect('/login');
    }
    const exam = result.rows[0];
    const selectedGrade = grade || exam.learner_grade;
    const selectedTerm = term || exam.term || '1';
    res.render('editExam.ejs', { exam, selectedGrade, selectedTerm });
  });

  app.post('/exams/:id/edit', isAuthenticated, isTeacher, async (req, res) => {
    const { id } = req.params;
    const {
      grade,
      term,
      english_cat1, english_cat2, english_main,
      kiswahili_cat1, kiswahili_cat2, kiswahili_main,
      mathematics_cat1, mathematics_cat2, mathematics_main,
      integrated_science_cat1, integrated_science_cat2, integrated_science_main,
      agriculture_cat1, agriculture_cat2, agriculture_main,
      social_studies_cat1, social_studies_cat2, social_studies_main,
      cre_cat1, cre_cat2, cre_main,
      pre_technical_cat1, pre_technical_cat2, pre_technical_main,
      creative_arts_cat1, creative_arts_cat2, creative_arts_main
    } = req.body;

    const parseRawMark = value => {
      if (value === '' || value === null || value === undefined) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const convertExamMark = (cat1, cat2, main) => {
      if (cat1 === null && cat2 === null && main === null) return null;
      const scoreCat1 = cat1 || 0;
      const scoreCat2 = cat2 || 0;
      const scoreMain = main || 0;
      return Math.round((scoreCat1 / 100 * 15) + (scoreCat2 / 100 * 15) + (scoreMain / 100 * 70));
    };

    const english = convertExamMark(parseRawMark(english_cat1), parseRawMark(english_cat2), parseRawMark(english_main));
    const kiswahili = convertExamMark(parseRawMark(kiswahili_cat1), parseRawMark(kiswahili_cat2), parseRawMark(kiswahili_main));
    const mathematics = convertExamMark(parseRawMark(mathematics_cat1), parseRawMark(mathematics_cat2), parseRawMark(mathematics_main));
    const integrated_science = convertExamMark(parseRawMark(integrated_science_cat1), parseRawMark(integrated_science_cat2), parseRawMark(integrated_science_main));
    const agriculture = convertExamMark(parseRawMark(agriculture_cat1), parseRawMark(agriculture_cat2), parseRawMark(agriculture_main));
    const social_studies = convertExamMark(parseRawMark(social_studies_cat1), parseRawMark(social_studies_cat2), parseRawMark(social_studies_main));
    const cre = convertExamMark(parseRawMark(cre_cat1), parseRawMark(cre_cat2), parseRawMark(cre_main));
    const pre_technical = convertExamMark(parseRawMark(pre_technical_cat1), parseRawMark(pre_technical_cat2), parseRawMark(pre_technical_main));
    const creative_arts = convertExamMark(parseRawMark(creative_arts_cat1), parseRawMark(creative_arts_cat2), parseRawMark(creative_arts_main));

    const { pl: english_pl, points: english_points } = getGradeAndPoints(english);
    const { pl: kiswahili_pl, points: kiswahili_points } = getGradeAndPoints(kiswahili);
    const { pl: mathematics_pl, points: mathematics_points } = getGradeAndPoints(mathematics);
    const { pl: integrated_science_pl, points: integrated_science_points } = getGradeAndPoints(integrated_science);
    const { pl: agriculture_pl, points: agriculture_points } = getGradeAndPoints(agriculture);
    const { pl: social_studies_pl, points: social_studies_points } = getGradeAndPoints(social_studies);
    const { pl: cre_pl, points: cre_points } = getGradeAndPoints(cre);
    const { pl: pre_technical_pl, points: pre_technical_points } = getGradeAndPoints(pre_technical);
    const { pl: creative_arts_pl, points: creative_arts_points } = getGradeAndPoints(creative_arts);

    const scores = [english, kiswahili, mathematics, integrated_science, agriculture, social_studies, cre, pre_technical, creative_arts];
    const validMarks = scores.filter(Number.isFinite);
    const evrg = validMarks.length === 9
      ? Math.round(validMarks.reduce((sum, n) => sum + n, 0) / 9)
      : null;
    const { pl: evrg_pl, points: evrg_points } = getGradeAndPoints(evrg);

    try {
      const updateResult = await db.query(
        `UPDATE learner_results SET
          english_cat1=$1, english_cat2=$2, english_main=$3, english=$4, english_pl=$5, english_points=$6,
          kiswahili_cat1=$7, kiswahili_cat2=$8, kiswahili_main=$9, kiswahili=$10, kiswahili_pl=$11, kiswahili_points=$12,
          mathematics_cat1=$13, mathematics_cat2=$14, mathematics_main=$15, mathematics=$16, mathematics_pl=$17, mathematics_points=$18,
          integrated_science_cat1=$19, integrated_science_cat2=$20, integrated_science_main=$21, integrated_science=$22, integrated_science_pl=$23, integrated_science_points=$24,
          agriculture_cat1=$25, agriculture_cat2=$26, agriculture_main=$27, agriculture=$28, agriculture_pl=$29, agriculture_points=$30,
          social_studies_cat1=$31, social_studies_cat2=$32, social_studies_main=$33, social_studies=$34, social_studies_pl=$35, social_studies_points=$36,
          cre_cat1=$37, cre_cat2=$38, cre_main=$39, cre=$40, cre_pl=$41, cre_points=$42,
          pre_technical_cat1=$43, pre_technical_cat2=$44, pre_technical_main=$45, pre_technical=$46, pre_technical_pl=$47, pre_technical_points=$48,
          creative_arts_cat1=$49, creative_arts_cat2=$50, creative_arts_main=$51, creative_arts=$52, creative_arts_pl=$53, creative_arts_points=$54,
          evrg=$55, evrg_pl=$56, evrg_points=$57
        WHERE id=$58 AND teacher_id=$59`,
        [
          english_cat1, english_cat2, english_main, english, english_pl, english_points,
          kiswahili_cat1, kiswahili_cat2, kiswahili_main, kiswahili, kiswahili_pl, kiswahili_points,
          mathematics_cat1, mathematics_cat2, mathematics_main, mathematics, mathematics_pl, mathematics_points,
          integrated_science_cat1, integrated_science_cat2, integrated_science_main, integrated_science, integrated_science_pl, integrated_science_points,
          agriculture_cat1, agriculture_cat2, agriculture_main, agriculture, agriculture_pl, agriculture_points,
          social_studies_cat1, social_studies_cat2, social_studies_main, social_studies, social_studies_pl, social_studies_points,
          cre_cat1, cre_cat2, cre_main, cre, cre_pl, cre_points,
          pre_technical_cat1, pre_technical_cat2, pre_technical_main, pre_technical, pre_technical_pl, pre_technical_points,
          creative_arts_cat1, creative_arts_cat2, creative_arts_main, creative_arts, creative_arts_pl, creative_arts_points,
          evrg, evrg_pl, evrg_points,
          id,
          req.user.id
        ]
      );
      if (!updateResult.rowCount) return res.redirect('/login');
      const redirectGrade = grade || req.query.grade;
      const redirectTerm = term ? `&term=${term}` : '';
      res.redirect(redirectGrade ? `/exams?grade=${redirectGrade}${redirectTerm}` : `/exams${redirectTerm}`);
    } catch (err) {
      console.error(err);
      res.render('error.ejs', { message: 'Error updating exam result' });
    }
  });

  // Delete exam result
  app.post('/exams/delete/:id', isAuthenticated, isTeacher, async (req, res) => {
    const { id } = req.params;
    const { grade, term } = req.body;
    try {
      const result = await db.query(
        'DELETE FROM learner_results WHERE id=$1 AND teacher_id=$2 RETURNING learner_id, term',
        [id, req.user.id]
      );
      const ownedResult = result.rows[0];
      if (!ownedResult) return res.redirect('/login');
      await db.query(
        'DELETE FROM learner_result_subjects WHERE learner_id=$1 AND term=$2 AND teacher_id=$3',
        [ownedResult.learner_id, ownedResult.term, req.user.id]
      );
      const redirectTarget = grade ? `/exams?grade=${grade}${term ? `&term=${term}` : ''}` : '/exams';
      res.redirect(redirectTarget);
    } catch (err) {
      console.error(err);
      res.render('error.ejs', { message: 'Error deleting exam result' });
    }
  });

  // Export exam results
  app.get('/exams/export', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term, assessment } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";

    if (!grade) {
      return res.render('error.ejs', { message: 'Grade is required for export' });
    }

    const normalizedGrade = grade.toString().trim();
    const selectedAssessmentType = assessment === 'summative' ? 'summative' : 'continous';

    const activeSubjectsResult = await db.query(
      `SELECT DISTINCT ON (rs.subject_code) rs.subject_code, rs.subject_name
       FROM learner_result_subjects rs
       JOIN learners l ON rs.learner_id = l.id
       WHERE rs.term = $1
         AND rs.teacher_id = $4
         AND BTRIM(rs.subject_code) ~ '^9(0[1-9]|1[0-2])$'
         AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
       ORDER BY rs.subject_code, rs.subject_name ASC`,
      [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, req.user.id]
    );

    const subjectDefinitions = activeSubjectsResult.rows.length > 0
      ? activeSubjectsResult.rows.map(row => ({
          key: normalizeSubjectCode(row.subject_code || row.subject_name),
          label: row.subject_name || row.subject_code
        }))
      : examSubjectDefinitions;

    let result;
    if (selectedAssessmentType === 'continous') {
      result = await db.query(
        `SELECT DISTINCT l.id AS learner_id, l.name, l.assessment_number, l.grade AS learner_grade, rs.term
         FROM learners l
         JOIN learner_result_subjects rs ON rs.learner_id = l.id
         WHERE rs.term = $1 AND rs.teacher_id = $4
           AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
         ORDER BY l.name`,
        [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, req.user.id]
      );
    }

    if (!result || result.rows.length === 0) {
      result = await db.query(
        `SELECT lr.id, lr.learner_id, lr.term, lr.evrg, lr.evrg_pl, lr.evrg_points, l.name, l.assessment_number, l.grade AS learner_grade
         FROM learner_results lr
         JOIN learners l ON lr.learner_id = l.id
         WHERE (LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3))
           AND lr.term = $2 AND lr.teacher_id = $4
         ORDER BY l.name`,
        [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`, req.user.id]
      );
    }

    const learnerIds = result.rows.map(row => row.learner_id).filter(Boolean);
    const learnerSubjectMap = new Map();
    if (learnerIds.length) {
      const subjectResult = await db.query(
        `SELECT rs.learner_id, rs.subject_code, rs.subject_name, rs.final_mark, rs.pl, rs.points
         FROM learner_result_subjects rs
         JOIN learners l ON rs.learner_id = l.id
         WHERE rs.term = $1
           AND rs.teacher_id = $5
           AND BTRIM(rs.subject_code) ~ '^9(0[1-9]|1[0-2])$'
           AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
           AND rs.learner_id = ANY($4)`,
        [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, learnerIds, req.user.id]
      );
      subjectResult.rows.forEach(row => {
        const key = normalizeSubjectCode(row.subject_code || row.subject_name);
        const existing = learnerSubjectMap.get(row.learner_id) || {};
        existing[key] = {
          mark: row.final_mark !== null ? row.final_mark : null,
          pl: row.pl || null,
          points: row.points || null
        };
        learnerSubjectMap.set(row.learner_id, existing);
      });
    }

    const subjKeys = subjectDefinitions.map(subject => subject.key);

    const learners = result.rows.map(row => {
      const subjectRows = learnerSubjectMap.get(row.learner_id) || {};
      let avrg = row.evrg ?? null;
      if (avrg === null) {
        let sum = 0;
        let count = 0;
        for (const key of subjKeys) {
          const value = Number(subjectRows[key]?.mark);
          if (Number.isFinite(value)) {
            sum += value;
            count += 1;
          }
        }
        avrg = count > 0 ? Math.round(sum / count) : null;
      }
      const { pl: avrg_pl, points: avrg_points } = avrg !== null ? getGradeAndPoints(avrg) : { pl: null, points: null };
      return {
        ...row,
        avrg,
        avrg_pl,
        avrg_points,
        subjectRows
      };
    });

    // sort by average descending then name
    learners.sort((a, b) => {
      const aAvg = Number(a.avrg);
      const bAvg = Number(b.avrg);
      if (Number.isFinite(aAvg) && Number.isFinite(bAvg) && aAvg !== bAvg) {
        return bAvg - aAvg;
      }
      if ((a.avrg || 0) !== (b.avrg || 0)) return (b.avrg || 0) - (a.avrg || 0);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    learners.forEach((r, i) => { r.pos = i + 1; });

    // Build CSV headers using short column names to save space
    const shortMap = {
      english: 'ENG',
      kiswahili: 'KIS',
      mathematics: 'MATH',
      integrated_science: 'INT',
      agriculture: 'AGR',
      social_studies: 'SS',
      cre: 'CRE',
      pre_technical: 'PT',
      creative_arts: 'CA'
    };

    const getShortSubjectLabel = label => {
      if (!label) return '';
      const normalized = label.replace(/[-_]/g, ' ').trim();
      const words = normalized.split(/\s+/).filter(Boolean);
      if (words.length === 1) {
        return words[0].length <= 4 ? words[0].toUpperCase() : words[0].slice(0, 3).toUpperCase();
      }
      return words.map(word => word[0].toUpperCase()).join('').slice(0, 4);
    };

    const headers = [
      'NM',
      'ASNO',
      'GRD',
      ...subjectDefinitions.flatMap(subject => [getShortSubjectLabel(subject.label), 'PL']),
      'AVRG',
      'AVRG_PL',
      'POS'
    ];

    if (req.query.format === 'print') {
      const subjectColumnWidth = subjKeys.length
        ? `${60 / (subjKeys.length * 2)}%`
        : '0%';
      const subjectHeaders = subjectDefinitions.map(subject => `
        <th colspan="2">${escapeHtml(getShortSubjectLabel(subject.label))}</th>
      `).join('');
      const tableRows = learners.map(learner => `
        <tr>
          <td class="name">${escapeHtml(learner.name || 'N/A')}</td>
          <td>${escapeHtml(learner.assessment_number || '—')}</td>
          <td>${escapeHtml(learner.learner_grade || grade)}</td>
          ${subjKeys.map(key => {
            const subjectRow = learner.subjectRows[key] || {};
            const mark = subjectRow.mark !== null && subjectRow.mark !== undefined
              ? subjectRow.mark
              : '—';
            return `<td>${escapeHtml(mark)}</td><td>${escapeHtml(subjectRow.pl || '—')}</td>`;
          }).join('')}
          <td>${escapeHtml(learner.avrg ?? '—')}</td>
          <td>${escapeHtml(learner.avrg_pl || '—')}</td>
          <td>${escapeHtml(learner.pos ?? '—')}</td>
        </tr>
      `).join('');

      const printHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Exam results - Grade ${escapeHtml(normalizedGrade)}, Term ${escapeHtml(selectedTerm)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; color: #111; font: 10px Arial, sans-serif; }
    .toolbar { margin-bottom: 12px; }
    button { padding: 7px 14px; cursor: pointer; }
    h1 { margin: 0 0 4px; font-size: 16px; text-align: center; }
    .subtitle { margin: 0 0 12px; text-align: center; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    th, td {
      border: 1px solid #555;
      padding: 3px 2px;
      text-align: center;
      overflow-wrap: anywhere;
    }
    th { background: #e9ecef; font-weight: 700; }
    tbody tr:nth-child(even) { background: #f5f5f5; }
    .name { text-align: left; }
    @page { size: A4 landscape; margin: 6mm; }
    @media print {
      body { padding: 0; font-size: 7pt; print-color-adjust: exact; }
      .toolbar { display: none; }
      h1 { font-size: 11pt; }
      .subtitle { margin-bottom: 6px; }
      th, td { padding: 2px 1px; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
  <h1>Exam Results — Grade ${escapeHtml(normalizedGrade)}</h1>
  <p class="subtitle">Term ${escapeHtml(selectedTerm)} · ${learners.length} learner(s)</p>
  <table>
    <colgroup>
      <col style="width:18%">
      <col style="width:7%">
      <col style="width:5%">
      ${subjKeys.map(() => `<col style="width:${subjectColumnWidth}"><col style="width:${subjectColumnWidth}">`).join('')}
      <col style="width:3.34%">
      <col style="width:3.33%">
      <col style="width:3.33%">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">Learner</th>
        <th rowspan="2">Assessment #</th>
        <th rowspan="2">Grade</th>
        ${subjectHeaders}
        <th rowspan="2">Average</th>
        <th rowspan="2">PL</th>
        <th rowspan="2">Pos</th>
      </tr>
      <tr>
        ${subjectDefinitions.map(() => '<th>Mark</th><th>PL</th>').join('')}
      </tr>
    </thead>
    <tbody>
      ${tableRows || `<tr><td colspan="${headers.length}">No results found for Grade ${escapeHtml(normalizedGrade)}.</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;
      return res.type('html').send(printHtml);
    }

    const escapeCsv = value => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    let csv = headers.map(escapeCsv).join(',') + '\n';

    const subjectTotals = subjKeys.reduce((acc, key) => ({ ...acc, [key]: { sum: 0, count: 0 } }), {});
    let avrgTotal = 0;
    let avrgCount = 0;

    learners.forEach(row => {
      const cols = [];
      cols.push(row.name ?? '');
      cols.push(row.assessment_number ?? '');
      cols.push(row.learner_grade ?? grade);
      for (const key of subjKeys) {
        const subjectRow = row.subjectRows[key] || {};
        const mark = subjectRow.mark !== null && subjectRow.mark !== undefined ? Number(subjectRow.mark) : null;
        if (Number.isFinite(mark)) {
          subjectTotals[key].sum += mark;
          subjectTotals[key].count += 1;
        }
        cols.push(subjectRow.mark ?? '');
        cols.push(subjectRow.pl ?? '');
      }
      if (Number.isFinite(Number(row.avrg))) {
        avrgTotal += Number(row.avrg);
        avrgCount += 1;
      }
      cols.push(row.avrg ?? '');
      cols.push(row.avrg_pl ?? '');
      cols.push(row.pos ?? '');

      csv += cols.map(escapeCsv).join(',') + '\n';
    });

    const averageCols = [];
    averageCols.push('Average');
    averageCols.push('');
    averageCols.push('');
    for (const key of subjKeys) {
      const avg = subjectTotals[key].count > 0 ? (subjectTotals[key].sum / subjectTotals[key].count) : null;
      averageCols.push(avg !== null ? Number(avg.toFixed(2)) : '');
      averageCols.push('');
    }
    const overallAvg = avrgCount > 0 ? Number((avrgTotal / avrgCount).toFixed(2)) : '';
    averageCols.push(overallAvg);
    averageCols.push('');
    averageCols.push('');

    csv += averageCols.map(escapeCsv).join(',') + '\n';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="exam-results-grade-${grade}.csv"`);
    res.send(csv);
  });

  app.get('/exams/bestin', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    if (!grade) {
      return res.render('error.ejs', { message: 'Grade is required for BestIn export' });
    }

    const normalizedGrade = grade.toString().trim();

    const activeSubjectsResult = await db.query(
      `SELECT DISTINCT ON (rs.subject_code) rs.subject_code, rs.subject_name
       FROM learner_result_subjects rs
       JOIN learners l ON rs.learner_id = l.id
       WHERE rs.term = $1 AND rs.teacher_id = $4
         AND BTRIM(rs.subject_code) ~ '^9(0[1-9]|1[0-2])$'
         AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
       ORDER BY rs.subject_code, rs.subject_name ASC`,
      [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, req.user.id]
    );

    const subjectDefinitions = Array.from(activeSubjectsResult.rows.reduce((definitions, row) => {
      const code = getCanonicalSubjectCode(row.subject_code || row.subject_name);
      const key = normalizeSubjectCode(code);
      if (!definitions.has(key)) {
        definitions.set(key, {
          key,
          label: row.subject_name || code,
          code: code || '-'
        });
      }
      return definitions;
    }, new Map()).values());

    const result = await db.query(
      `SELECT lr.id, lr.learner_id, lr.term, lr.evrg, lr.evrg_pl, lr.evrg_points, l.name, l.assessment_number, l.grade AS learner_grade, l.birth_certificate, l.class_teacher
       FROM learner_results lr
       JOIN learners l ON lr.learner_id = l.id
       WHERE (LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3))
         AND lr.term = $2 AND lr.teacher_id = $4
       ORDER BY l.name`,
      [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.render('error.ejs', { message: `No learners found for Grade ${grade} and Term ${selectedTerm}` });
    }

    const learnerIds = result.rows.map(row => row.learner_id).filter(Boolean);
    const learnerSubjectMap = new Map();
    if (learnerIds.length) {
      const subjectResult = await db.query(
        `SELECT rs.learner_id, rs.subject_code, rs.subject_name, rs.final_mark, rs.pl, rs.points
         FROM learner_result_subjects rs
         JOIN learners l ON rs.learner_id = l.id
         WHERE rs.term = $1 AND rs.teacher_id = $5
           AND BTRIM(rs.subject_code) ~ '^9(0[1-9]|1[0-2])$'
           AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
           AND rs.learner_id = ANY($4)`,
        [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, learnerIds, req.user.id]
      );
      subjectResult.rows.forEach(row => {
        const key = normalizeSubjectCode(getCanonicalSubjectCode(row.subject_code || row.subject_name));
        const existing = learnerSubjectMap.get(row.learner_id) || {};
        existing[key] = {
          mark: row.final_mark !== null ? row.final_mark : null,
          pl: row.pl || null,
          points: row.points || null,
          label: row.subject_name || row.subject_code
        };
        learnerSubjectMap.set(row.learner_id, existing);
      });
    }

    const learners = result.rows.map(row => {
      const subjectRows = learnerSubjectMap.get(row.learner_id) || {};
      const marks = subjectDefinitions.map(subject => ({
        key: subject.key,
        label: subject.label,
        code: subject.code || '-',
        mark: subjectRows[subject.key]?.mark !== null && subjectRows[subject.key]?.mark !== undefined
          ? Number(subjectRows[subject.key].mark)
          : null
      }));

      const validMarks = marks.filter(m => Number.isFinite(m.mark));
      const sum = validMarks.reduce((acc, current) => acc + current.mark, 0);
      const evrg = validMarks.length > 0 ? Math.round(sum / validMarks.length) : null;

      const bestSubjectEntry = validMarks.length > 0
        ? validMarks.reduce((best, current) => current.mark > best.mark ? current : best, validMarks[0])
        : null;

      const bestSubjectMark = bestSubjectEntry ? bestSubjectEntry.mark : null;
      const bestSubjectLabel = bestSubjectEntry ? bestSubjectEntry.label : null;
      const bestSubjectGrade = bestSubjectMark !== null ? getGradeAndPoints(bestSubjectMark).pl : null;
      const bestSubjectPoints = bestSubjectMark !== null ? getGradeAndPoints(bestSubjectMark).points : null;
      const improvementScore = bestSubjectMark !== null && evrg !== null ? bestSubjectMark - evrg : null;

      return {
        ...row,
        evrg,
        bestSubjectLabel,
        bestSubjectMark,
        bestSubjectGrade,
        bestSubjectPoints,
        improvementScore,
        subjectRows: marks.map(item => {
          const { pl, points } = getGradeAndPoints(item.mark);
          return {
            label: item.label,
            code: item.code || '-',
            mark: item.mark !== null ? item.mark : '-',
            performance: pl || '-',
            points: points || '-'
          };
        })
      };
    });

    const bestInRankings = learners
      .filter(l => Number.isFinite(l.bestSubjectMark))
      .sort((a, b) => b.bestSubjectMark - a.bestSubjectMark || String(a.name).localeCompare(String(b.name)));
    const mostImprovedRankings = learners
      .filter(l => Number.isFinite(l.improvementScore))
      .sort((a, b) => b.improvementScore - a.improvementScore || b.bestSubjectMark - a.bestSubjectMark || String(a.name).localeCompare(String(b.name)))
      .slice(0, 1);

    const safeGrade = escapeHtml(normalizedGrade);
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentDate = `${day}-${month}-${year}`;

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Best In Report - Grade ${safeGrade}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; color: #222; }
    .page { width: 100%; max-width: 1100px; margin: 0 auto; padding: 16px; }
    .header { text-align: center; margin-bottom: 16px; }
    .title { font-size: 1.8rem; margin-bottom: 0.25rem; color: #1f4e79; }
    .subtitle { font-size: 0.95rem; color: #555; }
    .section { margin-top: 18px; }
    .section h2 { font-size: 1.05rem; margin-bottom: 10px; color: #1f4e79; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .card strong { display: inline-block; margin-bottom: 0; color: #333; min-width: 120px; }
    .table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; min-width: 620px; }
    th, td { padding: 8px 10px; border: 1px solid #dfe3ea; text-align: left; }
    th { background: #1f4e79; color: white; font-weight: 600; }
    tbody tr:nth-child(even) { background: #f7f9fc; }
    .label-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e9f2ff; color: #1f4e79; font-size: 0.85rem; }
    .score { font-weight: 700; }
    .report-footer { margin-top: 24px; text-align: center; color: #666; font-size: 0.9rem; }
    .learner-block { margin-top: 24px; page-break-inside: avoid; }
    .learner-block h3 { margin-bottom: 12px; font-size: 1rem; }
    .subject-table th, .subject-table td { text-align: center; }
    .subject-table .subject-name { text-align: left; }
    .meta-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .meta-wrap::-webkit-scrollbar { height: 8px; }
    .meta-wrap::-webkit-scrollbar-track { background: transparent; }
    .meta-wrap::-webkit-scrollbar-thumb { background: rgba(44, 90, 160, 0.6); border-radius: 4px; }
    .learner-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; row-gap: 6px; margin-bottom: 10px; min-width: 100%; }
    .meta-item { font-size: 0.92rem; line-height: 1.3; }
    .meta-item strong { display: inline-block; min-width: 100px; font-weight: 600; }
    @media (max-width: 768px) {
      .meta-wrap { margin-bottom: 8px; }
      .page { padding: 12px; }
      .summary-grid { grid-template-columns: 1fr; }
      .card { padding: 12px; }
      .title { font-size: 1.45rem; }
      .subtitle { font-size: 0.95rem; }
      .section { margin-top: 16px; }
      .section h2 { font-size: 1rem; }
      .page > div:first-child button { width: 100%; }
    }
    @media (max-width: 480px) {
      .page { padding: 10px; }
      .title { font-size: 1.2rem; }
      .subtitle { font-size: 0.9rem; }
      th, td { padding: 8px; font-size: 0.9rem; }
      .learner-block h3 { font-size: 0.95rem; }
      .label-pill { font-size: 0.8rem; }
    }
    @media print {
      body { background: white; -webkit-print-color-adjust: exact; }
      .page, .report-form { box-shadow: none; margin: 0; max-width: 900px; }
      .section { page-break-inside: avoid; }
      .learner-block { page-break-inside: avoid; }
      .page-break { page-break-after: always; }
      /* Ensure scroll wrappers expand for printing */
      .table-wrap, .info-wrap, .meta-wrap { overflow: visible !important; -webkit-overflow-scrolling: auto; }
      /* Allow tables to expand and not force horizontal scrolling */
      .subjects-table, .subject-table { min-width: 0 !important; width: 100% !important; }
      /* Keep compact grid layout when printing */
      .learner-info, .learner-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .back-button { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div style="margin-bottom: 16px;">
      <button onclick="window.history.back()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">← Go Back</button>
    </div>
    <div class="header">
      <div class="title">Best In & Most Improved Report</div>
      <div class="subtitle">Grade ${safeGrade} — Generated ${escapeHtml(currentDate)}</div>
    </div>

    <div class="section">
      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="card"><strong>Learners</strong><span>${learners.length}</span></div>
        <div class="card"><strong>Best In candidates</strong><span>${bestInRankings.length}</span></div>
        <div class="card"><strong>Most Improved candidates</strong><span>${mostImprovedRankings.length}</span></div>
      </div>
    </div>

    <div class="section">
      <h2>Best In Rankings</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Best Learning Area</th>
              <th>Mark</th>
              <th>Performance Level</th>
              <th>Points</th>
              <th>Overall Avg</th>
            </tr>
          </thead>
          <tbody>
`;
    bestInRankings.slice(0, 20).forEach((learner, idx) => {
      html += `
          <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(learner.name || 'N/A')}</td>
            <td>${escapeHtml(learner.bestSubjectLabel || 'N/A')}</td>
            <td>${escapeHtml(learner.bestSubjectMark !== null ? learner.bestSubjectMark : 'N/A')}</td>
            <td>${escapeHtml(learner.bestSubjectGrade || 'N/A')}</td>
            <td>${escapeHtml(learner.bestSubjectPoints !== null ? learner.bestSubjectPoints : 'N/A')}</td>
            <td>${escapeHtml(learner.evrg !== null ? learner.evrg : 'N/A')}</td>
          </tr>
`;
    });
    html += `
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Most Improved Rankings</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Best Learning Area</th>
              <th>Best Mark</th>
              <th>Overall Avg</th>
              <th>Improvement Gap</th>
            </tr>
          </thead>
          <tbody>
`;
    mostImprovedRankings.slice(0, 20).forEach((learner, idx) => {
      html += `
          <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(learner.name || 'N/A')}</td>
            <td>${escapeHtml(learner.bestSubjectLabel || 'N/A')}</td>
            <td>${escapeHtml(learner.bestSubjectMark !== null ? learner.bestSubjectMark : 'N/A')}</td>
            <td>${escapeHtml(learner.evrg !== null ? learner.evrg : 'N/A')}</td>
            <td>${escapeHtml(learner.improvementScore !== null ? learner.improvementScore : 'N/A')}</td>
          </tr>
`;
    });
    html += `
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Detailed Learner Report</h2>
`;
    learners.forEach(learner => {
      html += `
      <div class="learner-block card">
        <h3>${escapeHtml(learner.name || 'N/A')} — ${escapeHtml(learner.grade || 'N/A')}</h3>
        <div class="meta-wrap">
          <div class="learner-meta">
            <div class="meta-item"><strong>Assessment #:</strong>${escapeHtml(learner.assessment_number || 'N/A')}</div>
            <div class="meta-item"><strong>Birth Certificate:</strong>${escapeHtml(learner.birth_certificate || 'N/A')}</div>
            <div class="meta-item"><strong>Best Learning Area:</strong><span class="label-pill">${escapeHtml(learner.bestSubjectLabel || 'N/A')}</span></div>
            <div class="meta-item"><strong>Overall Average:</strong><span class="score">${escapeHtml(learner.evrg !== null ? learner.evrg : 'N/A')}</span></div>
            <div class="meta-item"><strong>Improvement Gap:</strong><span class="score">${escapeHtml(learner.improvementScore !== null ? learner.improvementScore : 'N/A')}</span></div>
          </div>
        </div>

        <div class="table-wrap">
          <table class="subject-table">
            <thead>
              <tr>
                <th>Learning Area</th>
                <th>Code</th>
                <th>Mark</th>
                <th>Performance</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
`;
      learner.subjectRows.forEach(subject => {
        html += `
            <tr>
              <td class="subject-name">${escapeHtml(subject.label)}</td>
              <td>${escapeHtml(subject.code)}</td>
              <td>${escapeHtml(subject.mark)}</td>
              <td>${escapeHtml(subject.performance)}</td>
              <td>${escapeHtml(subject.points)}</td>
            </tr>
`;
      });
      html += `
            </tbody>
          </table>
        </div>
      </div>
`;
    });
    html += `
    <div class="report-footer">Generated on ${escapeHtml(currentDate)} | Grade ${safeGrade} Best In / Most Improved Report</div>
  </div>
</body>
</html>
`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Rubric export - generate learner report forms
  app.get('/exams/rubric', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term, assessment } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const normalizedGrade = grade ? grade.toString().trim() : '';
    const selectedAssessmentType = assessment === 'summative' ? 'summative' : 'continous';

    await db.query(
      `DELETE FROM subjects
       WHERE subject_code IS NULL OR BTRIM(subject_code) = '' OR subject_code !~ '^[0-9]+$'`,
    );

    const codedSubjectsResult = await db.query(
      `SELECT name, subject_code::integer AS code
       FROM subjects
      WHERE subject_code ~ '^[0-9]+$'
       ORDER BY id ASC`,
    );

    const subjects = codedSubjectsResult.rows.map(row => ({
      key: normalizeSubjectCode(row.code),
      label: row.name || row.code,
      code: row.code,
    }));

    let result;
    if (selectedAssessmentType === 'continous') {
      result = await db.query(
        `SELECT DISTINCT l.id AS learner_id, l.name, l.grade, l.assessment_number, l.birth_cert_no, l.birth_certificate, l.class_teacher
         FROM learners l
         JOIN learner_result_subjects rs ON rs.learner_id = l.id
         WHERE rs.term = $1 AND rs.teacher_id = $4
           AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3))
         ORDER BY l.name`,
        [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, req.user.id]
      );
    }

    if (!result || result.rows.length === 0) {
      result = await db.query(
        `SELECT lr.id, lr.learner_id, lr.evrg, lr.evrg_pl, lr.evrg_points, l.name, l.grade, l.assessment_number, l.birth_cert_no, l.birth_certificate, l.class_teacher
         FROM learner_results lr
         JOIN learners l ON lr.learner_id = l.id
         WHERE (LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3))
           AND lr.term = $2 AND lr.teacher_id = $4
         ORDER BY l.name`,
        [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`, req.user.id]
      );
    }

    if (result.rows.length === 0) {
      return res.render('error.ejs', { message: `No learners found for Grade ${grade} and Term ${selectedTerm}` });
    }

    const learnerIds = result.rows.map(row => row.learner_id).filter(Boolean);
    const learnerSubjectMap = new Map();
    if (learnerIds.length) {
      const subjectResult = await db.query(
        `SELECT rs.learner_id, rs.subject_code, rs.subject_name, rs.final_mark, rs.pl, rs.points
         FROM learner_result_subjects rs
         JOIN learners l ON rs.learner_id = l.id
         WHERE rs.term = $1 AND rs.teacher_id = $5
           AND (LOWER(l.grade) = LOWER($2) OR LOWER(l.grade) = LOWER($3)) AND rs.learner_id = ANY($4)`,
        [selectedTerm, normalizedGrade, `Grade ${normalizedGrade}`, learnerIds, req.user.id]
      );

      subjectResult.rows.forEach(row => {
        const key = normalizeSubjectCode(row.subject_code || row.subject_name);
        const existing = learnerSubjectMap.get(row.learner_id) || {};
        existing[key] = {
          mark: row.final_mark !== null ? row.final_mark : null,
          pl: row.pl || null,
          points: row.points || null,
          label: row.subject_name || row.subject_code
        };
        learnerSubjectMap.set(row.learner_id, existing);
      });
    }

    const learners = result.rows.map(row => ({
      ...row,
      subjectRows: learnerSubjectMap.get(row.learner_id) || {}
    }));

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentDate = `${day}-${month}-${year}`;

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exam Rubric - Grade ${grade}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; }
    .page-break { page-break-after: always; margin-bottom: 1rem; }
    .report-form {
      background: white;
      padding: 1rem;
      margin: 0 auto 1rem;
      width: calc(210mm - 24mm);
      max-width: calc(210mm - 24mm);
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      border: 1px solid #ddd;
      page-break-inside: avoid;
    }
    .header {
      text-align: center;
      margin-bottom: 1rem;
      border-bottom: 2px solid #2c5aa0;
      padding-bottom: 0.75rem;
    }
    .header h1 {
      font-size: 1.4rem;
      color: #2c5aa0;
      font-weight: 700;
      margin-bottom: 0.35rem;
    }
    .header .subtitle { font-size: 0.85rem; color: #666; }
    .learner-info {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem 1rem;
      margin-bottom: 1rem;
      background: #f9f9f9;
      padding: 0.75rem;
      border-radius: 4px;
    }
    .info-row {
      display: flex;
      align-items: baseline;
      gap: 0;
      width: 100%;
      padding: 0.15rem 0;
      border-bottom: 1px solid #eee;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      font-weight: 600;
      color: #333;
      flex-shrink: 0;
      min-width: 0;
    }
    .info-value {
      color: #555;
      text-align: left;
      flex: 1;
      word-break: break-word;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 0.95rem;
    }
    .info-wrap,
    .table-wrap {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: rgba(44, 90, 160, 0.6) transparent;
      margin-top: 0.75rem;
    }
    .info-wrap::-webkit-scrollbar,
    .table-wrap::-webkit-scrollbar {
      height: 8px;
    }
    .info-wrap::-webkit-scrollbar-track,
    .table-wrap::-webkit-scrollbar-track {
      background: transparent;
    }
    .info-wrap::-webkit-scrollbar-thumb,
    .table-wrap::-webkit-scrollbar-thumb {
      background: rgba(44, 90, 160, 0.6);
      border-radius: 4px;
    }
    .table-wrap::-webkit-scrollbar {
      height: 8px;
    }
    .table-wrap::-webkit-scrollbar-track {
      background: transparent;
    }
    .table-wrap::-webkit-scrollbar-thumb {
      background: rgba(44, 90, 160, 0.6);
      border-radius: 4px;
    }
    .subjects-table {
      width: 100%;
      min-width: 100%;
      border-collapse: collapse;
      margin-top: 0;
    }
    .subjects-table thead {
      background: #2c5aa0;
      color: white;
    }
    .subjects-table th {
      padding: 0.5rem 0.65rem;
      text-align: left;
      font-weight: 600;
      border: 1px solid #2c5aa0;
      font-size: 0.9rem;
    }
    .subjects-table td {
      padding: 0.45rem 0.65rem;
      border: 1px solid #ddd;
      text-align: center;
      font-size: 0.9rem;
    }
    .subjects-table tbody tr:nth-child(even) {
      background: #f9f9f9;
    }
    .subjects-table tbody tr:hover {
      background: #f0f5ff;
    }
    .subject-name {
      text-align: left;
      font-weight: 500;
      color: #333;
    }
    .subject-code {
      text-align: left;
      color: #555;
      font-weight: 500;
    }
    .mark { color: #2c5aa0; font-weight: 600; }
    .pl { color: #28a745; font-weight: 600; }
    .pl { color: #28a745; font-weight: 600; }
    .overall-row {
      background: #e8f0ff;
      font-weight: 700;
    }
    .overall-row td {
      border: 2px solid #2c5aa0;
    }
    .footer {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 0.82rem;
      color: #999;
    }
    .back-button {
      display: inline-block;
      padding: 8px 16px;
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .back-button:hover {
      background: #5a6268;
    }
    .comments-wrap {
      margin-top: 1rem;
    }
    .comments-title {
      font-weight: 600;
      margin-bottom: 0.35rem;
    }
    .comments-line {
      display: block;
      width: 100%;
      min-height: 1.2rem;
      border-bottom: 1px dotted #444;
      margin: 0 0 0.75rem;
    }
    .comments-line.short {
      width: 60%;
    }
    .comments-row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }
    .comments-field {
      flex: 1 1 45%;
      min-width: 180px;
    }
    .comments-line.inline {
      display: inline-block;
      width: auto;
      min-width: 35%;
      margin-right: 1rem;
      vertical-align: middle;
    }
    @media (max-width: 768px) {
      body { padding: 0 0.5rem; }
      .report-form {
        padding: 0.75rem;
        margin-bottom: 0.75rem;
      }
      .header h1 { font-size: 1.3rem; }
      .header .subtitle { font-size: 0.8rem; }
      .learner-info { grid-template-columns: 1fr; gap: 0.4rem; padding: 0.6rem; }
      .info-row { padding: 0.1rem 0; }
      .info-label { min-width: 90px; font-size: 0.92rem; }
      .info-value { font-size: 0.92rem; }
      .subjects-table th,
      .subjects-table td { padding: 0.4rem 0.5rem; font-size: 0.86rem; }
      .subjects-table { margin-top: 0.6rem; }
      .back-button { width: 100%; }
    }
    @media (max-width: 480px) {
      .page-break { margin-bottom: 0.5rem; }
      .report-form { padding: 0.55rem; }
      .header h1 { font-size: 1.15rem; }
      .header .subtitle { font-size: 0.75rem; }
      .info-label { min-width: 70px; font-size: 0.88rem; }
      .info-value { font-size: 0.88rem; }
      .subjects-table th,
      .subjects-table td { padding: 0.3rem 0.45rem; font-size: 0.82rem; }
      .subjects-table { min-width: 600px; }
    }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      body { background: white; -webkit-print-color-adjust: exact; margin: 0; }
      .page-break { margin-bottom: 0; }
      .page-break:not(:last-child) { page-break-after: always; }
      .report-form { box-shadow: none; margin: 0 auto; width: calc(210mm - 24mm); max-width: calc(210mm - 24mm); page-break-inside: avoid; padding: 1rem; }
      .header { margin-bottom: 0.65rem; padding-bottom: 0.45rem; }
      .header h1 { font-size: 1.2rem; }
      .header .subtitle { font-size: 0.85rem; }
      .learner-info { padding: 0.6rem; gap: 0.35rem 0.9rem; }
      .info-row { padding: 0.1rem 0; }
      .info-label { font-size: 0.9rem; }
      .info-value { font-size: 0.9rem; }
      .subjects-table th,
      .subjects-table td { padding: 0.25rem 0.35rem; font-size: 0.78rem; }
      .footer { margin-top: 0.85rem; padding-top: 0.5rem; font-size: 0.78rem; }
      .comments-wrap { margin-top: 0.85rem; }
      .comments-title { font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
      .comments-line { min-height: 1rem; margin: 0 0 0.55rem; }
      .comments-row { gap: 0.6rem; }
      .comments-field { min-width: 170px; }
      .comments-line.short { width: 60%; }
      .back-button { display: none; }
      .table-wrap, .info-wrap, .meta-wrap { overflow: visible !important; -webkit-overflow-scrolling: auto; }
      .subjects-table, .subject-table { min-width: 0 !important; width: 100% !important; }
      .learner-info, .learner-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <button class="back-button" onclick="window.history.back();">← Go Back</button>
`;
    learners.forEach((learner, idx) => {
      html += `
  <div class="page-break">
    <div class="report-form">
      <div class="header">
        <h1>EXAM RUBRIC</h1>
        <div class="subtitle">KAITHANGO COMPREHENSIVE SCHOOL</div>
      </div>

      <div class="info-wrap">
        <div class="learner-info">
          <div class="info-row">
            <span class="info-label">Learner Name:&nbsp;</span><span class="info-value">${learner.name || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Assessment #:&nbsp;</span><span class="info-value">${learner.assessment_number || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Grade:&nbsp;</span><span class="info-value">${learner.grade || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Birth Cert No:&nbsp;</span><span class="info-value">${learner.birth_cert_no || learner.birth_certificate || 'N/A'}</span>
          </div>
        </div>
      </div>

      <div class="table-wrap">
        <table class="subjects-table">
          <thead>
            <tr>
              <th>Learning Area</th>
              <th>Code</th>
              <th>Mark</th>
              <th>Performance Level</th>
            </tr>
          </thead>
        <tbody>
`;
      subjects.forEach(subj => {
        const subjectData = learner.subjectRows[subj.key] || {};
        const mark = subjectData.mark !== null && subjectData.mark !== undefined ? subjectData.mark : '-';
        const pl = subjectData.pl || '-';
        const isOverall = subj.key === 'evrg';
        
        html += `
          <tr ${isOverall ? 'class="overall-row"' : ''}>
            <td class="subject-name">${subj.label}</td>
            <td class="subject-code">${subj.code || '-'}</td>
            <td class="mark">${mark}</td>
            <td class="pl">${pl}</td>
          </tr>
`;
      });

      html += `
        </tbody>
        </table>
      </div>

      <div class="comments-wrap">
        <p class="comments-title">Class teacher's comments on competencies achieved/behavior/acquisition of values /performance Level</p>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <p class="comments-title">Learner’s general performance level</p>
        <div class="comments-line"></div>
        <div class="comments-line"></div>
        <div class="comments-row">
          <div class="comments-field">
            <p class="comments-title">Closing Date</p>
            <div class="comments-line short"></div>
          </div>
          <div class="comments-field">
            <p class="comments-title">Opening Date</p>
            <div class="comments-line short"></div>
          </div>
        </div>
        <p class="comments-title">Class Teacher’s Signature</p>
        <div class="comments-line short"></div>
        <div class="comments-field" style="display:flex; align-items:center; gap:10px;">
          <div style="flex:1;">
            <p class="comments-title">Principal’s Signature</p>
            <div class="comments-line short"></div>
          </div>
          <span style="font-size:0.95rem; color:#444; white-space:nowrap;">Official Stamp</span>
        </div>
      </div>

      <div class="footer">
        <p>Generated on ${currentDate} | Exam Results Report</p>
      </div>
    </div>
  </div>
`;
    });

    html += `
</body>
</html>
`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Homework routes
  app.get('/exams/homework', isAuthenticated, isTeacher, async (req, res) => {
    try {
      const grades = Array.from({ length: 9 }, (_, index) => String(index + 1));
      const subjects = await getSubjectDefinitionsFromDb();
      res.render('addHomework.ejs', { grades, subjects, selectedGrade: null });
    } catch (err) {
      console.error(err);
      res.render('error.ejs', { message: 'Error loading homework form' });
    }
  });

  app.post('/exams/homework', isAuthenticated, isTeacher, homeworkUpload.single('document'), async (req, res) => {
    try {
      const { grade, subject, task_description, term } = req.body;
      const documentPath = req.file ? path.posix.join('uploads/homework', req.file.filename) : null;

      if (!grade) {
        return res.render('error.ejs', { message: 'Grade is required' });
      }

      if (!documentPath) {
        return res.render('error.ejs', { message: 'Document upload is required' });
      }

      const normalizedGrade = grade.toString().trim();
      const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
      const userId = req.user.id;

      await db.query(
        `INSERT INTO homework (teacher_id, grade, term, subject, task_description, document_path)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, normalizedGrade, selectedTerm, subject || null, task_description || null, documentPath]
      );

      res.redirect(`/exams?grade=${grade}&term=${selectedTerm}`);
    } catch (err) {
      console.error('Homework upload error:', err);
      res.render('error.ejs', { message: err.message || 'Error uploading homework' });
    }
  });

  app.get('/exams/homework/:homeworkId/document', isAuthenticated, isTeacher, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.homeworkId))) return res.redirect('/login');
    try {
      const result = await db.query(
        `SELECT document_path
         FROM homework
         WHERE id = $1 AND teacher_id = $2`,
        [req.params.homeworkId, req.user.id]
      );
      const homework = result.rows[0];
      if (!homework?.document_path) return res.redirect('/login');
      const filePath = await getHomeworkFilePath(homework.document_path);
      return res.download(filePath);
    } catch (err) {
      console.error('Homework document download error:', err);
      return res.status(500).render('error.ejs', { message: 'Error downloading homework document' });
    }
  });

  app.get('/exams/homework/submissions/:submissionId/document', isAuthenticated, isTeacher, async (req, res) => {
    if (!/^\d+$/.test(String(req.params.submissionId))) return res.redirect('/login');
    try {
      const result = await db.query(
        `SELECT hs.answer_document_path
         FROM homework_submissions hs
         JOIN homework h ON h.id = hs.homework_id
         WHERE hs.id = $1 AND h.teacher_id = $2`,
        [req.params.submissionId, req.user.id]
      );
      const submission = result.rows[0];
      if (!submission?.answer_document_path) return res.redirect('/login');
      const filePath = await getHomeworkFilePath(submission.answer_document_path);
      return res.download(filePath);
    } catch (err) {
      console.error('Homework answer download error:', err);
      return res.status(500).render('error.ejs', { message: 'Error downloading homework answer' });
    }
  });

  app.get('/exams/homework/submissions', isAuthenticated, isTeacher, async (req, res) => {
    try {
      const { grade, term } = req.query;
      const selectedTerm = ["1", "2", "3"].includes(term) ? term : null;
      const baseQuery = `
        SELECT hs.id AS submission_id, hs.homework_id, hs.learner_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at, hs.feedback_at,
               h.grade AS homework_grade, h.term AS homework_term, h.subject, h.task_description, h.document_path AS homework_document_path,
               u.name AS teacher_name,
               l.name AS learner_name, l.assessment_number, l.grade AS learner_grade
        FROM homework_submissions hs
        JOIN homework h ON hs.homework_id = h.id
        JOIN learners l ON hs.learner_id = l.id
        JOIN users u ON h.teacher_id = u.id
      `;

      let queryText = baseQuery + ' WHERE h.teacher_id = $1 ORDER BY hs.submitted_at DESC';
      let queryParams = [req.user.id];
      if (grade && selectedTerm) {
        queryText = baseQuery + ' WHERE h.teacher_id = $1 AND h.grade = $2 AND h.term = $3 ORDER BY hs.submitted_at DESC';
        queryParams = [req.user.id, grade, selectedTerm];
      } else if (grade) {
        queryText = baseQuery + ' WHERE h.teacher_id = $1 AND h.grade = $2 ORDER BY hs.submitted_at DESC';
        queryParams = [req.user.id, grade];
      } else if (selectedTerm) {
        queryText = baseQuery + ' WHERE h.teacher_id = $1 AND h.term = $2 ORDER BY hs.submitted_at DESC';
        queryParams = [req.user.id, selectedTerm];
      }

      const subjectDefinitions = await getSubjectDefinitionsFromDb();
      const submissions = await db.query(queryText, queryParams);
      const submissionsWithLabels = submissions.rows.map(row => ({
        ...row,
        subject_name: getSubjectDisplayLabel(row.subject, subjectDefinitions)
      }));

      res.render('homeworkSubmissions.ejs', {
        submissions: submissionsWithLabels,
        selectedGrade: grade || null,
      });
    } catch (err) {
      console.error('Error loading homework submissions:', err);
      res.render('error.ejs', { message: 'Error loading homework submissions' });
    }
  });

  app.get('/exams/homework/submissions/:submissionId/edit', isAuthenticated, isTeacher, async (req, res) => {
    try {
      const { submissionId } = req.params;
      const result = await db.query(
        `SELECT hs.id AS submission_id, hs.homework_id, hs.learner_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at, hs.feedback_at,
                h.grade AS homework_grade, h.subject, h.task_description, h.document_path AS homework_document_path,
                u.name AS teacher_name,
                l.name AS learner_name, l.assessment_number, l.grade AS learner_grade
         FROM homework_submissions hs
         JOIN homework h ON hs.homework_id = h.id
         JOIN learners l ON hs.learner_id = l.id
         JOIN users u ON h.teacher_id = u.id
         WHERE hs.id = $1 AND h.teacher_id = $2
         LIMIT 1`,
        [submissionId, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.redirect('/login');
      }

      const subjectDefinitions = await getSubjectDefinitionsFromDb();
      const submission = {
        ...result.rows[0],
        subject_name: getSubjectDisplayLabel(result.rows[0].subject, subjectDefinitions)
      };

      res.render('gradeHomeworkSubmission.ejs', {
        submission,
      });
    } catch (err) {
      console.error('Error loading submission grading form:', err);
      res.render('error.ejs', { message: 'Error loading grading form.' });
    }
  });

  app.post('/exams/homework/submissions/:submissionId/grade', isAuthenticated, isTeacher, async (req, res) => {
    try {
      const { submissionId } = req.params;
      const { teacher_score, teacher_feedback } = req.body;
      const score = Number(teacher_score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return res.render('error.ejs', { message: 'Score must be a number between 0 and 100.' });
      }

      const updatedSubmission = await db.query(
        `UPDATE homework_submissions
         SET teacher_score = $1,
             teacher_feedback = $2,
             feedback_at = now()
         WHERE id = $3
           AND EXISTS (
             SELECT 1 FROM homework h
             WHERE h.id = homework_submissions.homework_id AND h.teacher_id = $4
           )
         RETURNING id`,
        [score, teacher_feedback || null, submissionId, req.user.id]
      );
      if (!updatedSubmission.rowCount) return res.redirect('/login');

      const submissions = await db.query(`SELECT h.grade FROM homework_submissions hs JOIN homework h ON hs.homework_id = h.id WHERE hs.id = $1 AND h.teacher_id = $2 LIMIT 1`, [submissionId, req.user.id]);
      const grade = submissions.rows[0]?.grade;
      res.redirect(`/exams/homework/submissions${grade ? `?grade=${grade}` : ''}`);
    } catch (err) {
      console.error('Error grading submission:', err);
      res.render('error.ejs', { message: 'Error saving homework grade.' });
    }
  });
}
