import { Pool } from 'pg';

import { runMigrations } from './migration-runner.js';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';

const pool = new Pool({ connectionString });

try {
  await runMigrations(pool);
  console.info('Database migrations are up to date.');
} finally {
  await pool.end();
}
