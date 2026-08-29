import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';

const [, , command, ...args] = process.argv;

if (!command) {
  process.stderr.write(
    'Usage: node scripts/with-supabase-db.mjs <command> [args...]\n',
  );
  process.exit(1);
}

const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'leknhhxqqehwiaxvzwnt';
const poolerHost =
  process.env.SUPABASE_POOLER_HOST ?? 'aws-1-eu-west-1.pooler.supabase.com';

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.platform !== 'darwin') {
    process.stderr.write(
      'DATABASE_URL is required outside macOS. Use the Supabase Session pooler URL with sslmode=require&uselibpqcompat=true.\n',
    );
    process.exit(1);
  }

  const password = execFileSync(
    'security',
    [
      'find-generic-password',
      '-a',
      process.env.USER ?? '',
      '-s',
      'math-study-companion-supabase-db',
      '-w',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();

  databaseUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${poolerHost}:5432/postgres?sslmode=require&uselibpqcompat=true`;
}

const child = spawn(command, args, {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});

child.once('error', (error) => {
  process.stderr.write(`Could not start ${command}: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
