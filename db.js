import pg from 'pg';
import dotenv from "dotenv";

dotenv.config();

// Create a pg db using DATABASE_URL
const db = new pg.Pool({
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
        date_created TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (learner_id, term, subject_code)
      )
    `);

    console.log('Subjects and subject result tables are ready');
  } catch (err) {
    console.error('Database connection failed:', err.stack || err);
  }
};

connectDatabase();

export default db;
