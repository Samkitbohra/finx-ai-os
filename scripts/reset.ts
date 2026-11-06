import 'dotenv/config';
import { Pool } from 'pg';
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
  console.log('Database reset.');
})();
