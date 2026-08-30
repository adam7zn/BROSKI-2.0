import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { FakeMessagingProvider } from '@math-study-companion/conversation';

import { readConfig } from '../src/config.js';
import { InteractionStore } from '../src/local-store.js';
import { serve } from '../src/serve.js';

const workspace = mkdtempSync(join(tmpdir(), 'msc-serve-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives the serve loop the way a runner does, with the transport faked.
 *
 * This is the path both `pnpm telegram` and `pnpm imessage` take; the only
 * thing they add is which provider gets handed in.
 */
function configFor(name: string) {
  const databasePath = join(workspace, `${name}.db`);
  const studyPlanPath = join(workspace, `${name}-study.json`);
  const coursePlanPath = join(workspace, `${name}-course.json`);
  writeFileSync(
    studyPlanPath,
    JSON.stringify([
      {
        id: 'lin',
        topic: 'linjära ekvationer',
        sourceText: 'Gör samma sak på båda sidor.',
        difficulty: 'easy',
        image: null,
      },
    ]),
  );
  writeFileSync(
    coursePlanPath,
    JSON.stringify({
      courseName: 'Ma2c',
      timezone: 'Europe/Stockholm',
      lessons: [],
    }),
  );

  return {
    ...readConfig(),
    databasePath,
    studyPlanPath,
    coursePlanPath,
    hasModelKey: false,
    replyTimeoutMs: 3000,
  };
}

function profileFor(databasePath: string): void {
  const store = new InteractionStore(databasePath);
  store.saveProfile('chat-1', {
    displayName: 'William',
    schoolYear: 2,
    age: null,
    className: null,
    course: { code: 'Ma2c', raw: 'Ma2c' },
    textbook: 'Matematik 5000+',
    currentTopic: 'ekvationer',
    selfAssessedLevel: 'okay',
    previousGrade: null,
    lessonSlots: [],
    nextAssessment: null,
    quietHours: { start: '21:00', end: '07:00' },
    timezone: 'Europe/Stockholm',
    language: 'sv',
    updatedAt: new Date().toISOString(),
  });
  store.close();
}

test('a message gets an answer, without a model key', async () => {
  const config = configFor('answers');
  profileFor(config.databasePath);

  const messaging = new FakeMessagingProvider();
  const controller = new AbortController();

  const running = serve({
    config,
    messaging,
    inbound: messaging,
    downloader: null,
    conversationId: 'chat-1',
    signal: controller.signal,
    stopAfterOne: true,
    force: false,
  });

  await sleep(20);
  messaging.deliver('chat-1', 'hej');
  await running;
  controller.abort();

  // Without a book indexed the honest answer is that it cannot answer — but it
  // has to say so, not stay silent.
  const replies = messaging.sent.map((sent) => sent.text);
  assert.ok(replies.length > 0, 'the companion said nothing at all');
  assert.match(replies.at(-1)!, /ingen bok inlagd/);
});
