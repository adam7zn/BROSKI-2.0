import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, so the runners work from any working directory. */
export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/**
 * Reads `.env` into `process.env` without overwriting anything already set.
 *
 * An existing but empty variable counts as unset: a container can declare a
 * name with no value (a devcontainer mapping a host variable that isn't there,
 * an unset Codespaces secret), and an empty declaration must not shadow the
 * `.env` file the person just wrote.
 *
 * Values stay in the process only — never logged, never sent to a model
 * (`docs/RULES.md` §5.7).
 */
export function loadEnvFile(path = resolve(repoRoot, '.env')): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

/** Key names present in `.env`, for diagnostics. Never their values. */
export function describeEnvKeys(path = resolve(repoRoot, '.env')): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => line !== '' && !line.startsWith('#') && line.includes('='),
    )
    .map((line) => {
      const key = line.slice(0, line.indexOf('=')).trim();
      const length = line.slice(line.indexOf('=') + 1).trim().length;
      return `${key} (${length} characters)`;
    })
    .join(', ');
}

/**
 * Turns a path a person typed into one that exists.
 *
 * pnpm runs a workspace script from inside the package, so a plain
 * `pnpm index-book chapter-1` looks for `apps/companion/chapter-1`. What they
 * meant was the folder they can see, at the top of the repository — so try
 * both, and say where you looked when neither is there.
 */
export function resolveUserPath(input: string): string {
  const fromCwd = resolve(process.cwd(), input);
  if (existsSync(fromCwd)) return fromCwd;

  const fromRepo = resolve(repoRoot, input);
  if (existsSync(fromRepo)) return fromRepo;

  throw new PathNotFoundError(input, [fromCwd, fromRepo]);
}

export class PathNotFoundError extends Error {
  constructor(
    readonly input: string,
    readonly tried: string[],
  ) {
    super(
      `Could not find "${input}". Looked in:\n` +
        tried.map((path) => `  ${path}`).join('\n'),
    );
    this.name = 'PathNotFoundError';
  }
}

export interface Config {
  databasePath: string;
  studyPlanPath: string;
  coursePlanPath: string;
  telegramToken: string;
  telegramChatId: string;
  sendblue: {
    apiBaseUrl: string;
    apiKeyId: string;
    apiSecretKey: string;
    fromNumber: string;
    recipientNumber: string;
    webhookSecret: string;
    webhookPort: number;
    /** Nothing is sent to a real phone until this is deliberately turned on. */
    liveEnabled: boolean;
  };
  hasModelKey: boolean;
  replyTimeoutMs: number;
}

export function readConfig(): Config {
  loadEnvFile();
  return {
    databasePath:
      process.env['MSC_DATABASE'] ?? resolve(repoRoot, 'data/companion.db'),
    studyPlanPath:
      process.env['MSC_STUDY_PLAN'] ??
      resolve(repoRoot, 'data/study-plan.json'),
    coursePlanPath:
      process.env['MSC_COURSE_PLAN'] ??
      resolve(repoRoot, 'data/course-plan.json'),
    telegramToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    telegramChatId: process.env['TELEGRAM_ALLOWED_CHAT_ID'] ?? '',
    sendblue: {
      apiBaseUrl:
        process.env['SENDBLUE_API_BASE_URL'] ?? 'https://api.sendblue.co',
      apiKeyId: process.env['SENDBLUE_API_KEY_ID'] ?? '',
      apiSecretKey: process.env['SENDBLUE_API_SECRET_KEY'] ?? '',
      fromNumber: process.env['SENDBLUE_FROM_NUMBER'] ?? '',
      recipientNumber: process.env['SENDBLUE_RECIPIENT_NUMBER'] ?? '',
      webhookSecret: process.env['SENDBLUE_WEBHOOK_SECRET'] ?? '',
      webhookPort: Number(process.env['SENDBLUE_WEBHOOK_PORT'] ?? 8787),
      liveEnabled: process.env['MESSAGING_LIVE_ENABLED'] === 'true',
    },
    hasModelKey: Boolean(process.env['ANTHROPIC_API_KEY']),
    replyTimeoutMs: Number(
      process.env['MSC_REPLY_TIMEOUT_MS'] ?? 30 * 60 * 1000,
    ),
  };
}
