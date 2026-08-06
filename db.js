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
      CREATE TABLE IF NOT EXISTS learner_result_subjects (
        id SERIAL PRIMARY KEY,
        learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (learner_id, term, subject_code)
      )
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
