import db from "../db.js";
import fs from "fs/promises";
import path from "path";
import homeworkUpload from "../homeworkUpload.js";
import { lessonNoteDocumentHtml, lessonNoteFilename, lessonNoteContentHtml } from "../utils/lessonNoteDocument.js";

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.redirect("/login");
}

function normalizeGrade(value) {
  if (value === null || value === undefined) return null;
  const normalized = value.toString().trim();
  return normalized.replace(/^grade\s*/i, '').trim();
}

function splitStoredValues(value) {
  if (value === null || value === undefined || value === '') return [];
  return String(value).split('\n');
}

async function resolveLearnerGrade(userProfile) {
  let grade = normalizeGrade(userProfile.grade);
  if (grade) return grade;

  const assessment = userProfile.assessment_number?.toString().trim();
  if (assessment) {
    const learnerRow = await db.query(
      `SELECT grade FROM learners WHERE assessment_number = $1 LIMIT 1`,
      [assessment],
    );
    grade = normalizeGrade(learnerRow.rows[0]?.grade);
    if (grade) return grade;
  }

  if (userProfile.name) {
    const learnerRow = await db.query(
      `SELECT grade FROM learners WHERE LOWER(name) = LOWER($1) OR LOWER(assessment_number) = LOWER($2) LIMIT 1`,
      [userProfile.name.toString().trim(), assessment || ''],
    );
    grade = normalizeGrade(learnerRow.rows[0]?.grade);
  }

  return grade;
}

async function resolveLearnerId(userProfile) {
  const assessment = userProfile.assessment_number?.toString().trim();
  if (assessment) {
    const learnerRow = await db.query(
      `SELECT id FROM learners WHERE assessment_number = $1 LIMIT 1`,
      [assessment],
    );
    const id = learnerRow.rows[0]?.id;
    if (id) return id;
  }

  if (userProfile.name) {
    const learnerRow = await db.query(
      `SELECT id FROM learners WHERE LOWER(name) = LOWER($1) OR LOWER(assessment_number) = LOWER($2) LIMIT 1`,
      [userProfile.name.toString().trim(), assessment || ''],
    );
    return learnerRow.rows[0]?.id || null;
  }

  return null;
}

const normalizeSubjectCode = code =>
  code
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

const summativeSubjectFallbacks = [
  ['english', 'English', '901'],
  ['kiswahili', 'Kiswahili', '902'],
  ['mathematics', 'Mathematics', '903'],
  ['integrated_science', 'Integrated Science', '905'],
  ['agriculture', 'Agriculture', '906'],
  ['social_studies', 'Social Studies', '907'],
  ['cre', 'Christian Religious Education (CRE)', '908'],
  ['creative_arts', 'Creative Arts & Sports', '911'],
  ['pre_technical', 'Pre-Technical Studies', '912'],
].map(([key, label, code]) => ({ key, label, code }));

const summativeKeyByCode = {
  '101': 'english',
  '901': 'english',
  '102': 'kiswahili',
  '902': 'kiswahili',
  '103': 'mathematics',
  '903': 'mathematics',
  '105': 'integrated_science',
  '905': 'integrated_science',
  '106': 'agriculture',
  '906': 'agriculture',
  '107': 'social_studies',
  '907': 'social_studies',
  '108': 'cre',
  '908': 'cre',
  '111': 'creative_arts',
  '911': 'creative_arts',
  '112': 'pre_technical',
  '912': 'pre_technical',
};

function getSummativeSubjectKey(row) {
  const codeKey = summativeKeyByCode[String(row.subject_code || '').trim()];
  if (codeKey) return codeKey;

  const nameKey = normalizeSubjectCode(row.subject_name || '');
  if (nameKey === 'christian_religious_education' || nameKey.endsWith('_cre')) return 'cre';
  if (nameKey === 'creative_arts_sports') return 'creative_arts';
  if (nameKey === 'pre_technical_studies') return 'pre_technical';
  return nameKey;
}

function isLearner(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 3) {
    return next();
  }
  return res.status(403).send("Access denied. Learner privileges required.");
}

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

export default function registerLearnerRoutes(app) {
  app.get("/learner", isAuthenticated, isLearner, async (req, res) => {
    try {
      const userResult = await db.query(
        "SELECT id, name, email, phone, role, grade, assessment_number, profile_image, date_created FROM users WHERE id = $1",
        [req.user.id],
      );
      const userProfile = userResult.rows[0] || {};
      let grade = normalizeGrade(userProfile.grade) || normalizeGrade(req.user.grade);
      let learnerRecord = null;

      if (!grade && userProfile.assessment_number) {
        const learnerRow = await db.query(
          `SELECT grade FROM learners WHERE assessment_number = $1 LIMIT 1`,
          [userProfile.assessment_number],
        );
        grade = normalizeGrade(learnerRow.rows[0]?.grade) || grade;
      }

      if (!grade && userProfile.email) {
        const learnerRow = await db.query(
          `SELECT grade FROM learners WHERE LOWER(name) = LOWER($1) OR LOWER(assessment_number) = LOWER($2) LIMIT 1`,
          [userProfile.name || "", userProfile.assessment_number || ""],
        );
        grade = normalizeGrade(learnerRow.rows[0]?.grade) || grade;
      }

      const selectedTerm = ["1", "2", "3"].includes(req.query.term) ? req.query.term : "1";
      const assessmentType = req.query.assessment === 'summative' ? 'summative' : 'continous';
      const showContinuousAssessment = assessmentType === 'continous';

      let learnerId = null;

      if (userProfile.assessment_number) {
        const learnerRow = await db.query(
          `SELECT id, grade FROM learners WHERE assessment_number = $1 LIMIT 1`,
          [userProfile.assessment_number],
        );
        learnerId = learnerRow.rows[0]?.id || null;
        userProfile.grade = userProfile.grade || learnerRow.rows[0]?.grade;
      }

      if (!learnerId && userProfile.name) {
        const learnerRow = await db.query(
          `SELECT id, grade FROM learners WHERE LOWER(name) = LOWER($1) OR LOWER(assessment_number) = LOWER($2) LIMIT 1`,
          [userProfile.name || '', userProfile.assessment_number || ''],
        );
        learnerId = learnerRow.rows[0]?.id || null;
        userProfile.grade = userProfile.grade || learnerRow.rows[0]?.grade;
      }

      let subjectDefinitions = [];
      let learnerSubjectRows = {};
      if (learnerId) {
        if (assessmentType === 'summative') {
          const specificLearner = await db.query(
            `SELECT lr.*, l.name, l.grade AS learner_grade, l.assessment_number, l.birth_certificate, l.class_teacher
             FROM learner_results lr
             JOIN learners l ON lr.learner_id = l.id
             WHERE lr.learner_id = $1 AND lr.term = $2
             ORDER BY lr.id DESC
             LIMIT 1`,
            [learnerId, selectedTerm],
          );
          learnerRecord = specificLearner.rows[0] || null;

          subjectDefinitions = summativeSubjectFallbacks;
          const continuousMarks = await db.query(
            `SELECT DISTINCT ON (subject_code) subject_code, subject_name, final_mark, pl, points
             FROM learner_result_subjects
             WHERE learner_id = $1 AND term = $2
             ORDER BY subject_code, updated_at DESC, id DESC`,
            [learnerId, selectedTerm],
          );
          const continuousMarkMap = {};
          continuousMarks.rows.forEach(row => {
            const key = getSummativeSubjectKey(row);
            continuousMarkMap[key] = row;
          });

          subjectDefinitions.forEach(subject => {
            const continuousRow = continuousMarkMap[subject.key];
            learnerSubjectRows[subject.key] = {
                mark: learnerRecord?.[subject.key] ?? continuousRow?.final_mark ?? null,
                pl: learnerRecord?.[`${subject.key}_pl`] || continuousRow?.pl || null,
                points: learnerRecord?.[`${subject.key}_points`] || continuousRow?.points || null,
                ee: null,
                ae: null,
                me: null,
                be: null,
                reflection: null,
                strand: null,
                sub_strand: null,
                lesson_title: null,
                code: subject.code,
                label: subject.label
            };
          });
        } else {
          const subjectResult = await db.query(
            `SELECT DISTINCT ON (rs.subject_code) rs.subject_code, rs.subject_name, rs.final_mark, rs.pl, rs.points,
                    rs.ee, rs.ae, rs.me, rs.be, rs.reflection,
                    rs.strand, rs.sub_strand, rs.lesson_title
             FROM learner_result_subjects rs
             WHERE rs.term = $1 AND rs.learner_id = $2
             ORDER BY rs.subject_code, rs.updated_at DESC, rs.id DESC`,
            [selectedTerm, learnerId],
          );

          subjectDefinitions = subjectResult.rows.map(row => {
            const key = normalizeSubjectCode(row.subject_code || row.subject_name || '');
            const substrands = splitStoredValues(row.sub_strand);
            const strands = splitStoredValues(row.strand);
            const reflections = splitStoredValues(row.reflection);
            const checks = {
              ee: splitStoredValues(row.ee),
              ae: splitStoredValues(row.ae),
              me: splitStoredValues(row.me),
              be: splitStoredValues(row.be)
            };
            const entryCount = Math.max(
              strands.length,
              substrands.length,
              reflections.length,
              ...Object.values(checks).map(values => values.length),
              1
            );
            const entries = Array.from({ length: entryCount }, (_, index) => ({
              sub_strand: substrands[index] || null,
              strand: strands[index] || null,
              reflection: reflections[index] || null,
              ee: checks.ee[index] === '1',
              ae: checks.ae[index] === '1',
              me: checks.me[index] === '1',
              be: checks.be[index] === '1'
            }));

            learnerSubjectRows[key] = {
              mark: row.final_mark !== null ? row.final_mark : null,
              pl: row.pl || null,
              points: row.points || null,
              code: row.subject_code || row.subject_name || null,
              ee: row.ee || null,
              ae: row.ae || null,
              me: row.me || null,
              be: row.be || null,
              reflection: row.reflection || null,
              strand: row.strand || null,
              sub_strand: row.sub_strand || null,
              lesson_title: row.lesson_title || null,
              entries,
              label: row.subject_name || row.subject_code || ''
            };
            return {
              key,
              label: row.subject_name || row.subject_code || '',
              code: row.subject_code || row.subject_name || ''
            };
          });
        }
      }

      const homeworkResult = await db.query(
        `SELECT h.id, h.teacher_id, h.grade, h.subject, h.task_description, h.document_path, h.created_at,
                u.name AS teacher_name,
                hs.id AS submission_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at
         FROM homework h
         JOIN users u ON h.teacher_id = u.id
         LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.learner_id = $1
         WHERE h.grade = $2
         ORDER BY h.created_at DESC`,
        [learnerId || null, grade],
      );
      const homeworkList = homeworkResult.rows || [];
      const lessonNotesResult = grade
        ? await db.query(
          `SELECT ln.id, ln.grade, ln.term, ln.subject_name, ln.strand, ln.sub_strand,
                  ln.week_no, ln.lesson_no, ln.lesson_content, ln.school_name, ln.roll,
                  TO_CHAR(ln.lesson_time, 'HH24:MI') AS lesson_time, ln.updated_at, u.name AS teacher_name
           FROM lesson_notes ln
           JOIN users u ON u.id = ln.teacher_id
           WHERE ln.grade = $1 AND ln.term = $2
           ORDER BY ln.subject_name, ln.week_no, ln.lesson_no`,
          [grade, selectedTerm]
        )
        : { rows: [] };
      const lessonNotes = lessonNotesResult.rows.map(note => ({
        ...note,
        contentHtml: lessonNoteContentHtml(note.lesson_content),
      }));

      console.log("Learner Route Debug:", {
        userId: req.user.id,
        assessment_number: userProfile.assessment_number,
        name: userProfile.name,
        term: selectedTerm,
        found: !!learnerRecord,
      });

      if (grade) {
        userProfile.grade = grade;
      }

      res.render("learnerDashboard.ejs", {
        user: req.user,
        userProfile,
        learnerRecord,
        selectedTerm,
        homeworkList,
        subjectDefinitions,
        learnerSubjectRows,
        lessonNotes,
        assessmentType,
        showContinuousAssessment,
      });
    } catch (err) {
      console.error("Learner dashboard error:", err.message);
      res.status(500).render("error.ejs", {
        message: "Error loading learner dashboard.",
        user: req.user,
      });
    }
  });

  app.get("/learner/lesson-notes/:id/download", isAuthenticated, isLearner, async (req, res) => {
    try {
      const userResult = await db.query(
        "SELECT id, name, grade, assessment_number FROM users WHERE id = $1",
        [req.user.id]
      );
      const grade = await resolveLearnerGrade(userResult.rows[0] || {});
      if (!grade) return res.status(404).send("Lesson notes not found.");

      const result = await db.query(
        `SELECT id, grade, term, subject_name, strand, sub_strand, week_no, lesson_no, lesson_content,
                school_name, roll, TO_CHAR(lesson_time, 'HH24:MI') AS lesson_time
         FROM lesson_notes
         WHERE id = $1 AND grade = $2`,
        [req.params.id, grade]
      );
      const note = result.rows[0];
      if (!note) return res.status(404).send("Lesson notes not found.");

      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${lessonNoteFilename(note)}"`);
      res.send(lessonNoteDocumentHtml(note));
    } catch (err) {
      console.error("Lesson note download error:", err.message);
      res.status(500).send("Unable to download lesson notes.");
    }
  });

  app.get("/learner/homework/:id/document", isAuthenticated, isLearner, async (req, res) => {
    try {
      const userResult = await db.query(
        "SELECT id, name, grade, assessment_number FROM users WHERE id = $1",
        [req.user.id]
      );
      const grade = await resolveLearnerGrade(userResult.rows[0] || {});
      if (!grade || !/^\d+$/.test(String(req.params.id))) return res.redirect("/login");
      const homeworkResult = await db.query(
        `SELECT document_path
         FROM homework
         WHERE id = $1 AND (LOWER(grade) = LOWER($2) OR LOWER(grade) = LOWER($3))`,
        [req.params.id, grade, `Grade ${grade}`]
      );
      const homework = homeworkResult.rows[0];
      if (!homework?.document_path) return res.redirect("/login");
      const filePath = await getHomeworkFilePath(homework.document_path);
      return res.download(filePath);
    } catch (err) {
      console.error("Homework document download error:", err.message);
      return res.status(500).render("error.ejs", { message: "Unable to download homework document." });
    }
  });

  app.get("/learner/homework/:id/answer-document", isAuthenticated, isLearner, async (req, res) => {
    try {
      const userResult = await db.query(
        "SELECT id, name, grade, assessment_number FROM users WHERE id = $1",
        [req.user.id]
      );
      const userProfile = userResult.rows[0] || {};
      const grade = await resolveLearnerGrade(userProfile);
      const learnerId = await resolveLearnerId(userProfile);
      if (!grade || !learnerId || !/^\d+$/.test(String(req.params.id))) return res.redirect("/login");
      const submissionResult = await db.query(
        `SELECT hs.answer_document_path
         FROM homework_submissions hs
         JOIN homework h ON h.id = hs.homework_id
         WHERE hs.homework_id = $1 AND hs.learner_id = $2
           AND (LOWER(h.grade) = LOWER($3) OR LOWER(h.grade) = LOWER($4))`,
        [req.params.id, learnerId, grade, `Grade ${grade}`]
      );
      const submission = submissionResult.rows[0];
      if (!submission?.answer_document_path) return res.redirect("/login");
      const filePath = await getHomeworkFilePath(submission.answer_document_path);
      return res.download(filePath);
    } catch (err) {
      console.error("Homework answer download error:", err.message);
      return res.status(500).render("error.ejs", { message: "Unable to download homework answer." });
    }
  });

  // Learner homework list
  app.get("/learner/homework", isAuthenticated, isLearner, async (req, res) => {
    try {
      const userResult = await db.query(
        "SELECT id, name, email, phone, role, grade, assessment_number FROM users WHERE id = $1",
        [req.user.id],
      );
      const userProfile = userResult.rows[0] || {};
      let grade = await resolveLearnerGrade(userProfile);
      const learnerId = await resolveLearnerId(userProfile);

      if (!grade && learnerId) {
        const learnerRow = await db.query(
          `SELECT grade FROM learners WHERE id = $1 LIMIT 1`,
          [learnerId],
        );
        grade = normalizeGrade(learnerRow.rows[0]?.grade);
      }

      if (!grade) {
        return res.render("error.ejs", { message: "Unable to determine your grade. Please update your profile." });
      }

      // Get all homework for learner's grade
      const homeworkResult = await db.query(
        `SELECT h.id, h.teacher_id, h.grade, h.subject, h.task_description, h.document_path, h.created_at,
                COALESCE(u.name, 'Teacher') AS teacher_name,
                hs.id AS submission_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at, hs.feedback_at
         FROM homework h
         LEFT JOIN users u ON h.teacher_id = u.id
         LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.learner_id = $1
         WHERE h.grade = $2
         ORDER BY h.created_at DESC`,
        [learnerId || null, grade],
      );

      const homeworkList = homeworkResult.rows || [];

      res.render("learnerHomework.ejs", {
        user: req.user,
        userProfile,
        grade,
        learnerId,
        homeworkList,
      });
    } catch (err) {
      console.error("Learner homework error:", err.message);
      res.status(500).render("error.ejs", {
        message: "Error loading homework.",
        user: req.user,
      });
    }
  });

  // View specific homework and submit answer
  app.get("/learner/homework/:id", isAuthenticated, isLearner, async (req, res) => {
    try {
      const { id } = req.params;

      const userResult = await db.query(
        "SELECT id, name, email, grade, assessment_number FROM users WHERE id = $1",
        [req.user.id],
      );
      const userProfile = userResult.rows[0] || {};
      const learnerId = await resolveLearnerId(userProfile);
      if (!learnerId) {
        console.warn(`Learner ID not found for user ${req.user.id}; viewing homework without submission context.`);
      }

      // Get homework details
      const homeworkResult = await db.query(
        `SELECT h.id, h.teacher_id, h.grade, h.subject, h.task_description, h.document_path, h.created_at,
                COALESCE(u.name, 'Teacher') AS teacher_name,
                hs.id AS submission_id, hs.answer_document_path, hs.teacher_score, hs.teacher_feedback, hs.submitted_at, hs.feedback_at
         FROM homework h
         LEFT JOIN users u ON h.teacher_id = u.id
         LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.learner_id = $1
         WHERE h.id = $2`,
        [learnerId, id],
      );

      if (homeworkResult.rows.length === 0) {
        return res.render("error.ejs", { message: "Homework not found." });
      }

      const homework = homeworkResult.rows[0];

      res.render("viewHomework.ejs", {
        user: req.user,
        userProfile,
        homework,
        learnerId,
      });
    } catch (err) {
      console.error("Error viewing homework:", err.message);
      res.status(500).render("error.ejs", {
        message: "Error loading homework details.",
        user: req.user,
      });
    }
  });

  // Submit homework answer
  app.post("/learner/homework/:id/submit", isAuthenticated, isLearner, homeworkUpload.single("answer_document"), async (req, res) => {
      if (!req.file) {
        return res.render("error.ejs", { message: "Document upload is required." });
      }

      try {
        const { id: homeworkId } = req.params;
        const answerDocumentPath = path.posix.join('uploads/homework', req.file.filename);

        const userResult = await db.query(
          "SELECT id, assessment_number, name FROM users WHERE id = $1",
          [req.user.id],
        );
        const userProfile = userResult.rows[0] || {};
        let learnerId = await resolveLearnerId(userProfile);

        // If resolveLearnerId couldn't find a mapping, try stricter lookups and as a last resort create a learner record.
        if (!learnerId) {
          // Try lookup by assessment number if present
          if (userProfile.assessment_number) {
            const lookup = await db.query(
              `SELECT id FROM learners WHERE assessment_number = $1 LIMIT 1`,
              [userProfile.assessment_number.toString().trim()]
            );
            learnerId = lookup.rows[0]?.id || null;
          }

          // Try lookup by name
          if (!learnerId && userProfile.name) {
            const lookupByName = await db.query(
              `SELECT id FROM learners WHERE LOWER(name) = LOWER($1) LIMIT 1`,
              [userProfile.name.toString().trim()]
            );
            learnerId = lookupByName.rows[0]?.id || null;
          }

          // As a last resort, create a learner record so the submission can be associated
          if (!learnerId) {
            const created = await db.query(
              `INSERT INTO learners (name, assessment_number, grade) VALUES ($1, $2, $3) RETURNING id`,
              [userProfile.name || null, userProfile.assessment_number || null, userProfile.grade || null]
            );
            learnerId = created.rows[0]?.id || null;
            console.warn(`Auto-created learner id=${learnerId} for user id=${req.user.id}`);
          }
        }

        const existingSubmissionResult = await db.query(
          `SELECT teacher_score FROM homework_submissions
           WHERE homework_id = $1 AND learner_id = $2
           LIMIT 1`,
          [homeworkId, learnerId],
        );
        const existingSubmission = existingSubmissionResult.rows[0];

        if (existingSubmission && existingSubmission.teacher_score !== null) {
          return res.render("error.ejs", {
            message: "This homework has already been graded and cannot be resubmitted.",
          });
        }

        // Insert or update submission
        await db.query(
          `INSERT INTO homework_submissions (homework_id, learner_id, answer_document_path)
           VALUES ($1, $2, $3)
           ON CONFLICT (homework_id, learner_id) DO UPDATE SET
           answer_document_path = EXCLUDED.answer_document_path,
           submitted_at = now()`,
          [homeworkId, learnerId, answerDocumentPath],
        );

        res.redirect("/learner/homework");
      } catch (err) {
        console.error("Error submitting homework:", err.message);
        res.render("error.ejs", { message: "Error submitting homework." });
      }
    });
}
