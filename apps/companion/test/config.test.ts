import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  PathNotFoundError,
  describeEnvKeys,
  loadEnvFile,
  resolveUserPath,
} from '../src/config.js';

const workspace = mkdtempSync(join(tmpdir(), 'msc-config-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

function envFile(contents: string): string {
  const path = join(workspace, `${Math.random().toString(36).slice(2)}.env`);
  writeFileSync(path, contents);
  return path;
}

test('an empty environment variable does not shadow the .env file', () => {
  // A devcontainer or an unset Codespaces secret can declare the name with no
  // value; the file the person just wrote has to win.
  process.env['MSC_TEST_EMPTY'] = '';
  loadEnvFile(envFile('MSC_TEST_EMPTY=from-the-file\n'));
  assert.equal(process.env['MSC_TEST_EMPTY'], 'from-the-file');
  delete process.env['MSC_TEST_EMPTY'];
});

test('a real environment variable still wins over the file', () => {
  process.env['MSC_TEST_SET'] = 'from-the-environment';
  loadEnvFile(envFile('MSC_TEST_SET=from-the-file\n'));
  assert.equal(process.env['MSC_TEST_SET'], 'from-the-environment');
  delete process.env['MSC_TEST_SET'];
});

test('comments, blank lines, and quotes are handled', () => {
  loadEnvFile(envFile('\n# a comment\nMSC_TEST_QUOTED="quoted value"\n'));
  assert.equal(process.env['MSC_TEST_QUOTED'], 'quoted value');
  delete process.env['MSC_TEST_QUOTED'];
});

test('a token pasted without its key name sets nothing', () => {
  // The likeliest typo: writing only the token into .env.
  const before = Object.keys(process.env).sort();
  loadEnvFile(envFile('123456:AAHfakefaketoken\n'));
  assert.deepEqual(Object.keys(process.env).sort(), before);
});

test('the diagnostic names keys and value lengths, never values', () => {
  const path = envFile('TELEGRAM_BOT_TOKEN=super-secret\n');
  const described = describeEnvKeys(path);
  assert.equal(described, 'TELEGRAM_BOT_TOKEN (12 characters)');
  assert.ok(!described.includes('super-secret'));
});

test('a missing file describes nothing', () => {
  assert.equal(describeEnvKeys(join(workspace, 'nope.env')), '');
});

test('a folder is found from the repository root, not only from the cwd', () => {
  // pnpm runs a workspace script from inside the package, so a path the person
  // typed while looking at the repository root would otherwise be missed.
  const found = resolveUserPath('package.json');
  assert.ok(found.endsWith('/package.json'));
  assert.ok(existsSync(found));
});

test('a path that is nowhere says where it looked', () => {
  assert.throws(
    () => resolveUserPath('definitivt-inte-en-riktig-mapp'),
    (error: unknown) => {
      assert.ok(error instanceof PathNotFoundError);
      assert.match(error.message, /Looked in:/);
      // Both candidates are named, so the person can see which one they meant.
      assert.equal(error.tried.length, 2);
      return true;
    },
  );
});
