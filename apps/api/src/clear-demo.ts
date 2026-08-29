import { clearJudgeDemoFixture } from '@math-study-companion/database';
import { Pool } from 'pg';

const connectionString =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres@127.0.0.1:54329/math_study_companion';
const hostname = new URL(connectionString).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
  throw new Error('Judge demo cleanup is restricted to local PostgreSQL');
}

const confirmation = confirmationArgument(process.argv.slice(2));
const pool = new Pool({ connectionString, connectionTimeoutMillis: 3_000 });

try {
  const cleared = await clearJudgeDemoFixture(pool, confirmation);
  console.log(JSON.stringify({ status: 'cleared', ...cleared }));
} finally {
  await pool.end();
}

function confirmationArgument(args: string[]): string {
  const index = args.indexOf('--confirm');
  if (index < 0 || !args[index + 1]) {
    throw new Error('Usage: clear-demo --confirm demo-001');
  }
  return args[index + 1]!;
}
