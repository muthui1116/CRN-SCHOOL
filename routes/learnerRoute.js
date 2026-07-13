import db from "../db.js";
import path from "path";
import homeworkUpload from "../homeworkUpload.js";

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

function isLearner(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === 3) {
    return next();
  }
  return res.status(403).send("Access denied. Learner privileges required.");
}

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

      if (learnerId) {
        const specificLearner = await db.query(
          `SELECT lr.*, l.name, l.grade AS learner_grade, l.assessment_number, l.birth_certificate, l.class_teacher
           FROM learner_results lr
           JOIN learners l ON lr.learner_id = l.id
           WHERE lr.learner_id = $1 AND lr.term = $2
           LIMIT 1`,
          [learnerId, selectedTerm],
        );
        learnerRecord = specificLearner.rows[0] || null;
      }

      let subjectDefinitions = [];
      let learnerSubjectRows = {};
      if (learnerId) {
        const subjectResult = await db.query(
          `SELECT rs.subject_code, rs.subject_name, rs.final_mark, rs.pl, rs.points
           FROM learner_result_subjects rs
           WHERE rs.term = $1 AND rs.learner_id = $2
           ORDER BY rs.subject_name ASC`,
          [selectedTerm, learnerId],
        );

        subjectDefinitions = subjectResult.rows.map(row => {
          const key = normalizeSubjectCode(row.subject_code || row.subject_name || '');
          learnerSubjectRows[key] = {
            mark: row.final_mark !== null ? row.final_mark : null,
            pl: row.pl || null,
            points: row.points || null,
            label: row.subject_name || row.subject_code || ''
          };
          return {
            key,
            label: row.subject_name || row.subject_code || ''
          };
        });
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
      });
    } catch (err) {
      console.error("Learner dashboard error:", err.message);
      res.status(500).render("error.ejs", {
        message: "Error loading learner dashboard.",
        user: req.user,
      });
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
