import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  AlreadyRunningError,
  acquireSingleInstance,
} from '../src/single-instance.js';

const workspace = mkdtempSync(join(tmpdir(), 'msc-lock-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

/** Higher than any pid_max, so nothing can be running under it. */
const DEAD_PID = 999_999_999;

test('a second companion is stopped, and told which one to close', () => {
  const lockPath = join(workspace, 'second.lock');
  const release = acquireSingleInstance(lockPath);

  try {
    assert.throws(
      () => acquireSingleInstance(lockPath),
      (error: unknown) => {
        assert.ok(error instanceof AlreadyRunningError);
        assert.equal(error.pid, process.pid);
        // Knowing that it is running is no use without knowing which one.
        assert.match(error.message, new RegExp(`kill ${process.pid}`));
        return true;
      },
    );
  } finally {
    release();
  }
});

test('letting go lets the next one in', () => {
  const lockPath = join(workspace, 'released.lock');
  acquireSingleInstance(lockPath)();
  assert.equal(existsSync(lockPath), false);

  const second = acquireSingleInstance(lockPath);
  second();
});

test('a lock left behind by a crash does not block the next start', () => {
  const lockPath = join(workspace, 'stale.lock');
  writeFileSync(lockPath, `${DEAD_PID}\n`);

  // A crash must not leave the companion unstartable.
  const release = acquireSingleInstance(lockPath);
  release();
});

test('a lock file with nothing readable in it is taken over', () => {
  const lockPath = join(workspace, 'garbage.lock');
  writeFileSync(lockPath, 'not a pid');

  const release = acquireSingleInstance(lockPath);
  release();
});
