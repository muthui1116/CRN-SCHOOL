// routes/examRoute.js
import db from "../db.js"; 
import path from "path";
import getGradeAndPoints from "../utils/getGradeAndPoints.js";
import homeworkUpload from "../homeworkUpload.js";

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
  return res.status(403).send("Access denied. Teacher privileges required.");
}

const examSubjectDefinitions = [
  { key: 'english', label: 'English' },
  { key: 'kiswahili', label: 'Kiswahili' },
  { key: 'mathematics', label: 'Mathematics' },
  { key: 'integrated_science', label: 'Integrated Science' },
  { key: 'agriculture', label: 'Agriculture' },
  { key: 'social_studies', label: 'Social Studies' },
  { key: 'cre', label: 'CRE' },
  { key: 'pre_technical', label: 'Pre-Technical' },
  { key: 'creative_arts', label: 'Creative Arts' }
];
const examSubjectKeys = examSubjectDefinitions.map(subject => subject.key);

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
    let learners = [];
    if (grade) {
      const normalizedGrade = grade.toString().trim();
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
         WHERE (LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3)) AND lr.term = $2
         ORDER BY l.name`,
        [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`]
      );
      learners = result.rows;

      const subjKeys = examSubjectKeys;
      learners = learners.map(l => {
        let sum = 0;
        let count = 0;
        for (const k of subjKeys) {
          const n = Number(l[k]);
          if (Number.isFinite(n)) {
            sum += n;
            count += 1;
          }
        }
        const avrg = count === subjKeys.length ? Math.round(sum / subjKeys.length) : null;
        return { ...l, avrg };
      });

      learners.sort((a, b) => (b.avrg || 0) - (a.avrg || 0));
      learners.forEach((l, idx) => { l.pos = idx + 1; });
    }

    let submittedHomework = [];
    if (grade) {
      const homeworkRows = await db.query(
        `SELECT hs.id AS submission_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at,
                h.id AS homework_id, h.subject, h.task_description, h.document_path, h.term,
                l.id AS learner_id, l.name AS learner_name, l.assessment_number
         FROM homework_submissions hs
         JOIN homework h ON hs.homework_id = h.id
         JOIN learners l ON hs.learner_id = l.id
         WHERE h.grade = $1 AND h.term = $2
         ORDER BY hs.submitted_at DESC`,
        [grade, selectedTerm]
      );
      submittedHomework = homeworkRows.rows;
    }

    res.render('examDashboard.ejs', {
      page: 'exams',
      selectedGrade: grade || null,
      learners,
      selectedTerm,
      submittedHomework,
    });
  });

  app.get('/exams/add', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term, learner_id } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const selectedLearnerId = learner_id || null;
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
         LEFT JOIN learner_results lr ON lr.learner_id = l.id AND lr.term = $2
         WHERE LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3)
         ORDER BY l.name`,
        [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`]
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
         LEFT JOIN learner_results lr ON lr.learner_id = l.id AND lr.term = $1
         ORDER BY l.grade, l.name`,
        [selectedTerm]
      );
    }
    const subjectDefinitions = getSubjectDefinitionsForGrade(grade);
    res.render('addExam.ejs', { grade: grade || null, selectedTerm, learners: result.rows, selectedLearnerId, subjectDefinitions });
  });

  app.post('/exams/add', isAuthenticated, isTeacher, async (req, res) => {
    const { learner_id, term, grade } = req.body;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const selectedGrade = grade || null;
    const subjectKeys = examSubjectKeys;

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

    let existingTermResult = {};
    try {
      const r = await db.query(
        'SELECT * FROM learner_results WHERE learner_id = $1 AND term = $2 LIMIT 1',
        [learner_id, selectedTerm]
      );
      existingTermResult = r.rows[0] || {};
    } catch (err) {
      console.error('Error fetching existing term result', err);
      return res.render('error.ejs', { message: 'Error fetching learner result' });
    }

    const g = {};
    for (const key of subjectKeys) {
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

    const numericMarks = subjectKeys.map(k => (typeof g[k] === 'number' ? g[k] : NaN));
    const validMarks = numericMarks.filter(Number.isFinite);
    const evrg = validMarks.length === 9
      ? Math.round(validMarks.reduce((sum, n) => sum + n, 0) / 9)
      : null;

    const { pl: evrg_pl, points: evrg_points } = getGradeAndPoints(evrg);
    g.evrg = evrg;
    g.evrg_pl = evrg_pl;
    g.evrg_points = evrg_points;

    try {
      await db.query(
        `INSERT INTO learner_results (
          learner_id, term,
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
          $1, $2,
          $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31, $32,
          $33, $34, $35, $36, $37, $38,
          $39, $40, $41, $42, $43, $44,
          $45, $46, $47, $48, $49, $50,
          $51, $52, $53, $54, $55, $56,
          $57, $58, $59
        )
        ON CONFLICT (learner_id, term) DO UPDATE SET
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
          learner_id, selectedTerm,
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
       WHERE lr.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).render('error.ejs', { message: 'Result not found' });
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
      await db.query(
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
        WHERE id=$58`,
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
          id
        ]
      );
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
      await db.query('DELETE FROM learner_results WHERE id=$1', [id]);
      const redirectTarget = grade ? `/exams?grade=${grade}${term ? `&term=${term}` : ''}` : '/exams';
      res.redirect(redirectTarget);
    } catch (err) {
      console.error(err);
      res.render('error.ejs', { message: 'Error deleting exam result' });
    }
  });

  // Export exam results
  app.get('/exams/export', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";

    if (!grade) {
      return res.render('error.ejs', { message: 'Grade is required for export' });
    }

    const normalizedGrade = grade.toString().trim();
    const result = await db.query(
      `SELECT lr.*, l.name, l.assessment_number, l.grade AS learner_grade
       FROM learner_results lr
       JOIN learners l ON lr.learner_id = l.id
       WHERE (LOWER(l.grade) = LOWER($1) OR LOWER(l.grade) = LOWER($3)) AND lr.term = $2
       ORDER BY l.name`,
      [normalizedGrade, selectedTerm, `Grade ${normalizedGrade}`]
    );


    const subjKeys = examSubjectKeys; // ordered subject keys

    // compute averages and final evrg values
    const learners = result.rows.map(row => {
      let sum = 0;
      let count = 0;
      for (const k of subjKeys) {
        const n = Number(row[k]);
        if (Number.isFinite(n)) {
          sum += n;
          count += 1;
        }
      }
      const avrg = count === subjKeys.length ? Math.round(sum / subjKeys.length) : null;
      const evrg = row.evrg ?? avrg;
      return { ...row, avrg, evrg };
    });

    // sort by evrg desc then name
    learners.sort((a, b) => {
      if ((b.evrg || 0) !== (a.evrg || 0)) return (b.evrg || 0) - (a.evrg || 0);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    learners.forEach((r, i) => { r.pos = i + 1; });

    // Build CSV headers using short column names to save space
    const shortMap = {
      english: 'eng',
      kiswahili: 'kis',
      mathematics: 'math',
      integrated_science: 'int',
      agriculture: 'agr',
      social_studies: 'ss',
      cre: 'cre',
      pre_technical: 'pt',
      creative_arts: 'ca'
    };

    const headers = [
      'name',
      'assNo',
      'grade',
      ...examSubjectKeys.flatMap(k => [shortMap[k] || k, 'pl']),
      'evrg',
      'pos'
    ];

    const escapeCsv = value => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };

    let csv = headers.map(escapeCsv).join(',') + '\n';

    learners.forEach(row => {
      const cols = [];
      cols.push(row.name ?? '');
      cols.push(row.assessment_number ?? '');
      cols.push(row.learner_grade ?? grade);
      for (const key of subjKeys) {
        cols.push(row[key] ?? '');
        cols.push(row[`${key}_pl`] ?? '');
      }
      cols.push(row.evrg ?? '');
      cols.push(row.pos ?? '');

      csv += cols.map(escapeCsv).join(',') + '\n';
    });

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

    const result = await db.query(
      `SELECT lr.*, l.name, l.assessment_number, l.birth_certificate, l.class_teacher
       FROM learner_results lr
       JOIN learners l ON lr.learner_id = l.id
       WHERE l.grade = $1 AND lr.term = $2
       ORDER BY l.name`,
      [grade, selectedTerm]
    );
    if (result.rows.length === 0) {
      return res.render('error.ejs', { message: `No learners found for Grade ${grade} and Term ${selectedTerm}` });
    }

    const parseMark = value => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const learners = result.rows.map(row => {
      const marks = examSubjectDefinitions.map(subject => ({
        key: subject.key,
        label: subject.label,
        mark: parseMark(row[subject.key])
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
  <title>Best In Report - Grade ${grade}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; color: #222; }
    .page { width: 100%; max-width: 1100px; margin: 0 auto; padding: 24px; }
    .header { text-align: center; margin-bottom: 24px; }
    .title { font-size: 2rem; margin-bottom: 0.25rem; color: #1f4e79; }
    .subtitle { font-size: 1rem; color: #555; }
    .section { margin-top: 24px; }
    .section h2 { font-size: 1.15rem; margin-bottom: 12px; color: #1f4e79; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
    .card strong { display: block; margin-bottom: 8px; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 10px 12px; border: 1px solid #dfe3ea; text-align: left; }
    th { background: #1f4e79; color: white; font-weight: 600; }
    tbody tr:nth-child(even) { background: #f7f9fc; }
    .label-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e9f2ff; color: #1f4e79; font-size: 0.85rem; }
    .score { font-weight: 700; }
    .report-footer { margin-top: 24px; text-align: center; color: #666; font-size: 0.9rem; }
    .learner-block { margin-top: 24px; page-break-inside: avoid; }
    .learner-block h3 { margin-bottom: 12px; font-size: 1rem; }
    .subject-table th, .subject-table td { text-align: center; }
    .subject-table .subject-name { text-align: left; }
    @media print {
      body { background: white; }
      .page { box-shadow: none; margin: 0; }
      .section { page-break-inside: avoid; }
      .learner-block { page-break-inside: avoid; }
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
      <div class="subtitle">Grade ${grade} — Generated ${currentDate}</div>
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
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Best Subject</th>
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
            <td>${learner.name || 'N/A'}</td>
            <td>${learner.bestSubjectLabel || 'N/A'}</td>
            <td>${learner.bestSubjectMark !== null ? learner.bestSubjectMark : 'N/A'}</td>
            <td>${learner.bestSubjectGrade || 'N/A'}</td>
            <td>${learner.bestSubjectPoints !== null ? learner.bestSubjectPoints : 'N/A'}</td>
            <td>${learner.evrg !== null ? learner.evrg : 'N/A'}</td>
          </tr>
`;
    });
    html += `
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Most Improved Rankings</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Best Subject</th>
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
            <td>${learner.name || 'N/A'}</td>
            <td>${learner.bestSubjectLabel || 'N/A'}</td>
            <td>${learner.bestSubjectMark !== null ? learner.bestSubjectMark : 'N/A'}</td>
            <td>${learner.evrg !== null ? learner.evrg : 'N/A'}</td>
            <td>${learner.improvementScore !== null ? learner.improvementScore : 'N/A'}</td>
          </tr>
`;
    });
    html += `
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Detailed Learner Report</h2>
`;
    learners.forEach(learner => {
      html += `
      <div class="learner-block card">
        <h3>${learner.name || 'N/A'} — ${learner.grade || 'N/A'}</h3>
        <div><strong>Assessment #:</strong> ${learner.assessment_number || 'N/A'}</div>
        <div><strong>Birth Certificate:</strong> ${learner.birth_certificate || 'N/A'}</div>
        <div><strong>Best Subject:</strong> <span class="label-pill">${learner.bestSubjectLabel || 'N/A'}</span></div>
        <div><strong>Overall Average:</strong> <span class="score">${learner.evrg !== null ? learner.evrg : 'N/A'}</span></div>
        <div><strong>Improvement Gap:</strong> <span class="score">${learner.improvementScore !== null ? learner.improvementScore : 'N/A'}</span></div>

        <table class="subject-table">
          <thead>
            <tr>
              <th>Subject</th>
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
              <td class="subject-name">${subject.label}</td>
              <td>${subject.mark}</td>
              <td>${subject.performance}</td>
              <td>${subject.points}</td>
            </tr>
`;
      });
      html += `
          </tbody>
        </table>
      </div>
`;
    });
    html += `
    <div class="report-footer">Generated on ${currentDate} | Grade ${grade} Best In / Most Improved Report</div>
  </div>
</body>
</html>
`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Rubric export - generate learner report forms
  app.get('/exams/rubric', isAuthenticated, isTeacher, async (req, res) => {
    const { grade, term } = req.query;
    const selectedTerm = ["1", "2", "3"].includes(term) ? term : "1";
    const result = await db.query(
      `SELECT lr.*, l.name, l.grade, l.assessment_number, l.birth_certificate, l.class_teacher
       FROM learner_results lr
       JOIN learners l ON lr.learner_id = l.id
       WHERE l.grade = $1 AND lr.term = $2
       ORDER BY l.name`,
      [grade, selectedTerm]
    );
    
    if (result.rows.length === 0) {
      return res.render('error.ejs', { message: `No learners found for Grade ${grade} and Term ${selectedTerm}` });
    }

    const subjects = [
      { key: 'english', label: 'English' },
      { key: 'kiswahili', label: 'Kiswahili' },
      { key: 'mathematics', label: 'Mathematics' },
      { key: 'integrated_science', label: 'Integrated Science' },
      { key: 'agriculture', label: 'Agriculture' },
      { key: 'social_studies', label: 'Social Studies' },
      { key: 'cre', label: 'CRE' },
      { key: 'pre_technical', label: 'Pre-Technical' },
      { key: 'creative_arts', label: 'Creative Arts' },
      { key: 'evrg', label: 'Overall Average' }
    ];

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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; }
    .page-break { page-break-after: always; margin-bottom: 2rem; }
    .report-form {
      background: white;
      padding: 2rem;
      margin: 0 auto 2rem;
      max-width: 900px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border: 1px solid #ddd;
    }
    .header {
      text-align: center;
      margin-bottom: 2rem;
      border-bottom: 3px solid #2c5aa0;
      padding-bottom: 1rem;
    }
    .header h1 {
      font-size: 1.8rem;
      color: #2c5aa0;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    .header .subtitle { font-size: 0.95rem; color: #666; }
    .learner-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 2rem;
      background: #f9f9f9;
      padding: 1rem;
      border-radius: 4px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #eee;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      font-weight: 600;
      color: #333;
      min-width: 140px;
    }
    .info-value {
      color: #555;
      text-align: right;
    }
    .subjects-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1.5rem;
    }
    .subjects-table thead {
      background: #2c5aa0;
      color: white;
    }
    .subjects-table th {
      padding: 0.75rem;
      text-align: left;
      font-weight: 600;
      border: 1px solid #2c5aa0;
    }
    .subjects-table td {
      padding: 0.75rem;
      border: 1px solid #ddd;
      text-align: center;
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
    .mark { color: #2c5aa0; font-weight: 600; }
    .pl { color: #28a745; font-weight: 600; }
    .overall-row {
      background: #e8f0ff;
      font-weight: 700;
    }
    .overall-row td {
      border: 2px solid #2c5aa0;
    }
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #ddd;
      text-align: center;
      font-size: 0.85rem;
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
    @media print {
      body { background: white; }
      .page-break { page-break-after: always; }
      .report-form { box-shadow: none; margin-bottom: 0; }
      .back-button { display: none; }
    }
  </style>
</head>
<body>
  <button class="back-button" onclick="window.history.back();">← Go Back</button>
`;
    result.rows.forEach((learner, idx) => {
      html += `
  <div class="page-break">
    <div class="report-form">
      <div class="header">
        <h1>EXAM RUBRIC</h1>
        <div class="subtitle">KAITHANGO COMPREHENSIVE SCHOOL</div>
      </div>

      <div class="learner-info">
        <div>
          <div class="info-row">
            <span class="info-label">Learner Name:</span>
            <span class="info-value">${learner.name || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Grade:</span>
            <span class="info-value">${learner.grade || 'N/A'}</span>
          </div>
        </div>
        <div>
          <div class="info-row">
            <span class="info-label">Assessment #:</span>
            <span class="info-value">${learner.assessment_number || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Date:</span>
            <span class="info-value">${currentDate}</span>
          </div>
        </div>
      </div>

      <table class="subjects-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Mark</th>
            <th>Performance Level</th>
          </tr>
        </thead>
        <tbody>
`;
      subjects.forEach(subj => {
        const mark = learner[subj.key] || '-';
        const pl = learner[`${subj.key}_pl`] || '-';
        const isOverall = subj.key === 'evrg';
        
        html += `
          <tr ${isOverall ? 'class="overall-row"' : ''}>
            <td class="subject-name">${subj.label}</td>
            <td class="mark">${mark}</td>
            <td class="pl">${pl}</td>
          </tr>
`;
      });

      html += `
        </tbody>
      </table>

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
      const grades = [];
      for (let g = 1; g <= 9; g++) {
        grades.push(String(g));
      }
      res.render('addHomework.ejs', { grades, selectedGrade: null });
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

      let queryText = baseQuery + ' ORDER BY hs.submitted_at DESC';
      let queryParams = [];
      if (grade && selectedTerm) {
        queryText = baseQuery + ' WHERE h.grade = $1 AND h.term = $2 ORDER BY hs.submitted_at DESC';
        queryParams = [grade, selectedTerm];
      } else if (grade) {
        queryText = baseQuery + ' WHERE h.grade = $1 ORDER BY hs.submitted_at DESC';
        queryParams = [grade];
      }

      const submissions = await db.query(queryText, queryParams);
      res.render('homeworkSubmissions.ejs', {
        submissions: submissions.rows,
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
         WHERE hs.id = $1
         LIMIT 1`,
        [submissionId]
      );

      if (result.rows.length === 0) {
        return res.render('error.ejs', { message: 'Submission not found.' });
      }

      res.render('gradeHomeworkSubmission.ejs', {
        submission: result.rows[0],
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

      await db.query(
        `UPDATE homework_submissions
         SET teacher_score = $1,
             teacher_feedback = $2,
             feedback_at = now()
         WHERE id = $3`,
        [score, teacher_feedback || null, submissionId]
      );

      const submissions = await db.query(`SELECT h.grade FROM homework_submissions hs JOIN homework h ON hs.homework_id = h.id WHERE hs.id = $1 LIMIT 1`, [submissionId]);
      const grade = submissions.rows[0]?.grade;
      res.redirect(`/exams/homework/submissions${grade ? `?grade=${grade}` : ''}`);
    } catch (err) {
      console.error('Error grading submission:', err);
      res.render('error.ejs', { message: 'Error saving homework grade.' });
    }
  });
}



