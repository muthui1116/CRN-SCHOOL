import pg from 'pg';
import dotenv from "dotenv";

dotenv.config();

// Create a pg db using DATABASE_URL
const db = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // connectionString: process.env.DATABASE_URL,
    // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test the database connection
const createLearnerResultsTable = `
CREATE TABLE IF NOT EXISTS learner_results (
  id SERIAL PRIMARY KEY,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  term VARCHAR(2) NOT NULL,
  english VARCHAR(50),
  english_pl VARCHAR(100),
  english_points VARCHAR(100),
  english_cat1 VARCHAR(50),
  english_cat2 VARCHAR(50),
  english_main VARCHAR(50),
  kiswahili VARCHAR(50),
  kiswahili_pl VARCHAR(100),
  kiswahili_points VARCHAR(100),
  kiswahili_cat1 VARCHAR(50),
  kiswahili_cat2 VARCHAR(50),
  kiswahili_main VARCHAR(50),
  mathematics VARCHAR(50),
  mathematics_pl VARCHAR(100),
  mathematics_points VARCHAR(100),
  mathematics_cat1 VARCHAR(50),
  mathematics_cat2 VARCHAR(50),
  mathematics_main VARCHAR(50),
  integrated_science VARCHAR(50),
  integrated_science_pl VARCHAR(100),
  integrated_science_points VARCHAR(100),
  integrated_science_cat1 VARCHAR(50),
  integrated_science_cat2 VARCHAR(50),
  integrated_science_main VARCHAR(50),
  agriculture VARCHAR(50),
  agriculture_pl VARCHAR(100),
  agriculture_points VARCHAR(100),
  agriculture_cat1 VARCHAR(50),
  agriculture_cat2 VARCHAR(50),
  agriculture_main VARCHAR(50),
  biology VARCHAR(50),
  biology_pl VARCHAR(100),
  biology_points VARCHAR(100),
  biology_cat1 VARCHAR(50),
  biology_cat2 VARCHAR(50),
  biology_main VARCHAR(50),
  cre VARCHAR(50),
  cre_pl VARCHAR(100),
  cre_points VARCHAR(100),
  cre_cat1 VARCHAR(50),
  cre_cat2 VARCHAR(50),
  cre_main VARCHAR(50),
  pre_technical VARCHAR(50),
  pre_technical_pl VARCHAR(100),
  pre_technical_points VARCHAR(100),
  pre_technical_cat1 VARCHAR(50),
  pre_technical_cat2 VARCHAR(50),
  pre_technical_main VARCHAR(50),
  creative_arts VARCHAR(50),
  creative_arts_pl VARCHAR(100),
  creative_arts_points VARCHAR(100),
  creative_arts_cat1 VARCHAR(50),
  creative_arts_cat2 VARCHAR(50),
  creative_arts_main VARCHAR(50),
  evrg VARCHAR(100),
  evrg_pl VARCHAR(100),
  evrg_points VARCHAR(100),
  UNIQUE (learner_id, term)
);
`;

const createHomeworkTable = `
CREATE TABLE IF NOT EXISTS homework(
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade VARCHAR(50) NOT NULL,
  term VARCHAR(2),
  subject VARCHAR(100),
  task_description TEXT,
  document_path VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const createHomeworkSubmissionsTable = `
CREATE TABLE IF NOT EXISTS homework_submissions(
  id SERIAL PRIMARY KEY,
  homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  answer_document_path VARCHAR(255),
  teacher_score INTEGER,
  teacher_feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  feedback_at TIMESTAMPTZ,
  UNIQUE (homework_id, learner_id)
);
`;

db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err.stack);
    } else {
        console.log('Database connected successfully');
        (async () => {
            try {
                await db.query(createLearnerResultsTable);
                console.log('learner_results table is ready');
                await db.query(createHomeworkTable);
                console.log('homework table is ready');
                await db.query(createHomeworkSubmissionsTable);
                console.log('homework_submissions table is ready');
                await db.query('ALTER TABLE homework_submissions ADD COLUMN IF NOT EXISTS teacher_score INTEGER');
                console.log('homework_submissions teacher_score column is ready');
                await db.query('ALTER TABLE homework ADD COLUMN IF NOT EXISTS term VARCHAR(2)');
                console.log('homework term column is ready');
            } catch (error) {
                console.error('Failed to ensure tables:', error.stack);
            }
        })();
    }
});

export default db;