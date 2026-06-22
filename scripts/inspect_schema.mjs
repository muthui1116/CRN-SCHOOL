import db from '../db.js';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
  try {
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'learner_results';");
    console.log(res.rows.map(r => r.column_name).sort().join('\n'));
  } catch (err) {
    console.error('Error querying schema:', err.message);
  } finally {
    await db.end();
  }
};

run();
