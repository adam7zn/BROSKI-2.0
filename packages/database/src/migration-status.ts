import { Pool } from 'pg';

import { inspectMigrationLedger } from './migration-runner.js';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';
const pool = new Pool({ connectionString, connectionTimeoutMillis: 3_000 });

try {
  const migrations = await inspectMigrationLedger(pool);
  process.stdout.write(`${JSON.stringify({ migrations }, null, 2)}\n`);
  if (migrations.some(({ state }) => state === 'checksum_mismatch')) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
