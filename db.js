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
  connectionString: process.env.DATABASE_URL,
});

db.on('error', err => {
  console.error('Unexpected error on idle database client:', err);
});

const connectDatabase = async () => {
  try {
    const client = await db.connect();
    client.release();
    console.log('Database connected successfully');

    await db.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(100),
        description TEXT,
        date_created TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.query(`
      ALTER TABLE subjects
      ADD COLUMN IF NOT EXISTS subject_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS short_name VARCHAR(30),
      ADD COLUMN IF NOT EXISTS grade_level VARCHAR(20)
    `);

    await db.query(`
      UPDATE subjects
      SET subject_code = COALESCE(subject_code, code),
          code = COALESCE(code, subject_code)
      WHERE subject_code IS NULL OR code IS NULL
    `);

    await db.query(`
      INSERT INTO subjects (name, code, subject_code, short_name, grade_level)
      SELECT seed.name, seed.subject_code, seed.subject_code, seed.short_name, seed.grade_level
      FROM (VALUES
        ('English', '901', 'ENG', 'JSS'),
        ('Kiswahili', '902', 'KIS', 'JSS'),
        ('Mathematics', '903', 'MATH', 'JSS'),
        ('Integrated Science', '905', 'INT SCI', 'JSS'),
        ('Agriculture', '906', 'AGR', 'JSS'),
        ('Social Studies', '907', 'SST', 'JSS'),
        ('Christian Religious Education', '908', 'CRE', 'JSS'),
        ('Creative Arts & Sports', '911', 'CAS', 'JSS'),
        ('Pre-Technical Studies', '912', 'PTS', 'JSS')
      ) AS seed(name, subject_code, short_name, grade_level)
      WHERE NOT EXISTS (
        SELECT 1 FROM subjects existing
        WHERE existing.subject_code = seed.subject_code OR existing.code = seed.subject_code
      )
    `);

    await db.query(`
      DELETE FROM subjects
      WHERE subject_code IS NULL OR BTRIM(subject_code) = '' OR subject_code !~ '^[0-9]+$'
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS grade VARCHAR(50)
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS assessment_number VARCHAR(255)
    `);

    await db.query(`
      ALTER TABLE learners
      ADD COLUMN IF NOT EXISTS birth_certificate VARCHAR(255),
      ADD COLUMN IF NOT EXISTS birth_cert_no VARCHAR(255),
      ADD COLUMN IF NOT EXISTS adn_no VARCHAR(255),
      ADD COLUMN IF NOT EXISTS responsibility VARCHAR(255)
    `);

    await db.query(`
      UPDATE learners
      SET birth_cert_no = birth_certificate
      WHERE birth_cert_no IS NULL AND birth_certificate IS NOT NULL
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS homework (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grade VARCHAR(50) NOT NULL,
        term VARCHAR(2),
        subject VARCHAR(100),
        task_description TEXT,
        document_path VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS homework_submissions (
        id SERIAL PRIMARY KEY,
        homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
        learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        answer_document_path VARCHAR(255),
        teacher_score INTEGER,
        teacher_feedback TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        feedback_at TIMESTAMPTZ,
        UNIQUE (homework_id, learner_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS teacher_schemes (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grade VARCHAR(2) NOT NULL,
        term VARCHAR(2) NOT NULL,
        document_path VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (teacher_id, grade, term)
      )
    `);

    await db.query(`
      ALTER TABLE teacher_schemes
      ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS lesson_notes (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grade VARCHAR(2) NOT NULL,
        term VARCHAR(2) NOT NULL,
        subject_code VARCHAR(100) NOT NULL,
        subject_name VARCHAR(100) NOT NULL,
        strand VARCHAR(255) NOT NULL,
        sub_strand TEXT NOT NULL,
        week_no INTEGER NOT NULL DEFAULT 1,
        lesson_no INTEGER NOT NULL,
        lesson_content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.query(`
      ALTER TABLE lesson_notes
      DROP CONSTRAINT IF EXISTS lesson_notes_teacher_id_grade_term_subject_code_key
    `);

    await db.query(`
      ALTER TABLE lesson_notes
      ADD COLUMN IF NOT EXISTS week_no INTEGER NOT NULL DEFAULT 1
    `);

    await db.query(`
      ALTER TABLE lesson_notes
      ADD COLUMN IF NOT EXISTS school_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS roll VARCHAR(50),
      ADD COLUMN IF NOT EXISTS lesson_time TIME
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS teacher_notes (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grade VARCHAR(2) NOT NULL,
        term VARCHAR(2) NOT NULL,
        subject_code VARCHAR(100) NOT NULL,
        subject_name VARCHAR(100) NOT NULL,
        title VARCHAR(150) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.query(`
      ALTER TABLE teacher_notes
      ADD COLUMN IF NOT EXISTS week_no INTEGER,
      ADD COLUMN IF NOT EXISTS lesson_no INTEGER,
      ADD COLUMN IF NOT EXISTS strand VARCHAR(255),
      ADD COLUMN IF NOT EXISTS sub_strand VARCHAR(255)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS learner_results (
        id SERIAL PRIMARY KEY,
        learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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
        social_studies VARCHAR(50),
        social_studies_pl VARCHAR(100),
        social_studies_points VARCHAR(100),
        social_studies_cat1 VARCHAR(50),
        social_studies_cat2 VARCHAR(50),
        social_studies_main VARCHAR(50),
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
        evrg_points VARCHAR(100)
      )
    `);

    await db.query(`
      ALTER TABLE learner_results
      ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    `);

    await db.query(`
      ALTER TABLE learner_results
      DROP CONSTRAINT IF EXISTS learner_results_learner_id_term_key
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS learner_results_learner_term_teacher_key
      ON learner_results (learner_id, term, teacher_id)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS learner_result_subjects (
        id SERIAL PRIMARY KEY,
        learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        term VARCHAR(2) NOT NULL,
        subject_code VARCHAR(100) NOT NULL,
        subject_name VARCHAR(100),
        cat1 VARCHAR(50),
        cat2 VARCHAR(50),
        main VARCHAR(50),
        final_mark VARCHAR(50),
        pl VARCHAR(100),
        points VARCHAR(100),
        ee VARCHAR(10),
        ae VARCHAR(10),
        me VARCHAR(10),
        be VARCHAR(10),
        strand VARCHAR(255),
        sub_strand VARCHAR(255),
        lesson_title VARCHAR(255),
        reflection TEXT,
        date_created TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.query(`
      ALTER TABLE learner_result_subjects
      ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    `);

    await db.query(`
      ALTER TABLE learner_result_subjects
      DROP CONSTRAINT IF EXISTS learner_result_subjects_learner_id_term_subject_code_key
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS learner_result_subjects_learner_term_subject_teacher_key
      ON learner_result_subjects (learner_id, term, subject_code, teacher_id)
    `);

    await db.query(`
      ALTER TABLE learner_result_subjects
      ALTER COLUMN ee TYPE TEXT,
      ALTER COLUMN ae TYPE TEXT,
      ALTER COLUMN me TYPE TEXT,
      ALTER COLUMN be TYPE TEXT,
      ALTER COLUMN sub_strand TYPE TEXT
    `);

    await db.query(`
      ALTER TABLE learner_result_subjects
      ADD COLUMN IF NOT EXISTS ee VARCHAR(10),
      ADD COLUMN IF NOT EXISTS ae VARCHAR(10),
      ADD COLUMN IF NOT EXISTS me VARCHAR(10),
      ADD COLUMN IF NOT EXISTS be VARCHAR(10),
      ADD COLUMN IF NOT EXISTS strand VARCHAR(255),
      ADD COLUMN IF NOT EXISTS sub_strand VARCHAR(255),
      ADD COLUMN IF NOT EXISTS lesson_title VARCHAR(255),
      ADD COLUMN IF NOT EXISTS reflection TEXT
    `);

    console.log('Subjects and subject result tables are ready');
  } catch (err) {
    console.error('Database connection failed:', err.stack || err);
  }
};

connectDatabase();

export default db;
