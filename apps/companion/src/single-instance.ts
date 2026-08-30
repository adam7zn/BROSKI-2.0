import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';

/**
 * Stops a second companion starting on the same data.
 *
 * Two companions on one bot both answer. Telegram hands each update to
 * whichever poller asked last, so the student gets two replies to one message
 * — and when the two are running different versions of this code, the two
 * replies disagree about which exercise they are even on. That is not a
 * confusing edge case for whoever set it up; it is a student being told two
 * different things about their homework.
 *
 * A leftover terminal is the normal way this happens, and nobody notices,
 * because the second one starts perfectly happily. So it stops here instead.
 */
export class AlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(
      `Broski is already running in another terminal (process ${pid}).\n\n` +
        'Two of them on one bot both answer, and the student gets two different\n' +
        'replies to one message. Stop the other one first:\n\n' +
        `  kill ${pid}\n\n` +
        'or close the terminal it is running in, then start this one again.',
    );
    this.name = 'AlreadyRunningError';
  }
}

/**
 * Takes the lock, and hands back how to let it go.
 *
 * A lock left behind by a process that has since died is taken over rather
 * than obeyed: a crash must not leave the companion unstartable.
 */
export function acquireSingleInstance(lockPath: string): () => void {
  // Twice: once to try, and once more after clearing a lock whose owner is
  // gone. A third failure means someone else won that race, which is the
  // answer we wanted anyway.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(lockPath, 'wx');
      try {
        writeSync(handle, `${process.pid}\n`);
      } finally {
        closeSync(handle);
      }
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // Already gone: someone cleared it as stale, or the disk went away.
        }
      };
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') throw error;

      const holder = readHolder(lockPath);
      if (holder !== null && isRunning(holder))
        throw new AlreadyRunningError(holder);

      try {
        unlinkSync(lockPath);
      } catch {
        // Someone else cleared it first; the next attempt will find out.
      }
    }
  }
  throw new Error(`Could not take the lock at ${lockPath}.`);
}

/** The pid in the lock file, or null when it holds nothing readable. */
function readHolder(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Whether that process still exists.
 *
 * Signal 0 checks without sending anything. EPERM means it is there and
 * belongs to someone else, which still counts as running.
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === 'EPERM';
  }
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
