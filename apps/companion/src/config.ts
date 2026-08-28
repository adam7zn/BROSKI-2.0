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
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export interface Config {
  databasePath: string;
  studyPlanPath: string;
  telegramToken: string;
  telegramChatId: string;
  hasModelKey: boolean;
  replyTimeoutMs: number;
}

export function readConfig(): Config {
  loadEnvFile();
  return {
    databasePath: process.env['MSC_DATABASE'] ?? resolve(repoRoot, 'data/companion.db'),
    studyPlanPath: process.env['MSC_STUDY_PLAN'] ?? resolve(repoRoot, 'data/study-plan.json'),
    telegramToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    telegramChatId: process.env['TELEGRAM_ALLOWED_CHAT_ID'] ?? '',
    hasModelKey: Boolean(process.env['ANTHROPIC_API_KEY']),
    replyTimeoutMs: Number(process.env['MSC_REPLY_TIMEOUT_MS'] ?? 30 * 60 * 1000),
  };
}
