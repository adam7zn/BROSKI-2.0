import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReplyInbox } from '../src/inbox.js';
import { FakeMessagingProvider } from '../src/messaging/fake.js';
import { runStudentSetup, summarise } from '../src/onboarding/student-setup.js';
import { OnboardingAbandoned } from '../src/onboarding/steps.js';

const CONVERSATION = 'chat-1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Answers the setup as a student would: waits for each question, then replies.
 * An empty string in the list means "say nothing and let it time out".
 */
function harness(answers: string[]) {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const controller = new AbortController();
  void inbox.pump(messaging, controller.signal);

  let answered = 0;
  void (async () => {
    while (answered < answers.length && !controller.signal.aborted) {
      // One reply per outgoing question, in order.
      const expected = answered + 1;
      while (messaging.sent.length < expected && !controller.signal.aborted) {
        await sleep(2);
      }
      if (controller.signal.aborted) return;
      await sleep(2);
      messaging.deliver(CONVERSATION, answers[answered]!);
      answered += 1;
    }
  })();

  return { messaging, inbox, stop: () => controller.abort() };
}

const FULL_ANSWERS = [
  'William', // name
  // the intro line expects no answer, so it consumes one "sent" slot
  'Ma2c', // course
  'Matematik 5000+ 2c', // textbook
  'andragradsekvationer', // current topic
  'tis 9.15 och tors 13', // lessons
  'kämpar lite', // level
  'tvåan', // year
  '17', // age
  'NA22B', // class
  '3 oktober', // assessment
  '21-07', // quiet hours
  'C', // grade
];

test('setup collects a whole profile from ordinary answers', async () => {
  const { messaging, inbox, stop } = harness(FULL_ANSWERS);

  const profile = await runStudentSetup({
    interactionId: 'setup-1',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 3000,
    today: new Date('2026-09-01T00:00:00Z'),
  });

  assert.equal(profile.displayName, 'William');
  assert.equal(profile.course?.code, 'Ma2c');
  assert.equal(profile.textbook, 'Matematik 5000+ 2c');
  assert.equal(profile.currentTopic, 'andragradsekvationer');
  assert.deepEqual(profile.lessonSlots, [
    { weekday: 'tuesday', startsAt: '09:15' },
    { weekday: 'thursday', startsAt: '13:00' },
  ]);
  assert.equal(profile.selfAssessedLevel, 'struggling');
  assert.equal(profile.schoolYear, 2);
  assert.equal(profile.age, 17);
  assert.equal(profile.className, 'NA22B');
  assert.equal(profile.nextAssessment?.date, '2026-10-03');
  assert.deepEqual(profile.quietHours, { start: '21:00', end: '07:00' });
  assert.equal(profile.previousGrade, 'C');
  stop();
});

test('the first thing it does is say hello and ask what to call him', async () => {
  const { messaging, inbox, stop } = harness(FULL_ANSWERS);
  await runStudentSetup({
    interactionId: 'setup-2',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 3000,
  });

  assert.match(messaging.sent[0]!.text, /^Hej! Jag heter Broski/);
  assert.match(messaging.sent[0]!.text, /Vad ska jag kalla dig\?$/);
  stop();
});

test('everything optional can be skipped and the profile still stands', async () => {
  const { messaging, inbox, stop } = harness([
    'Ada',
    'Ma3c',
    'Origo 3c',
    'derivata',
    'hoppa över', // lessons
    'okej',
    'hoppa över', // year
    'hoppa över', // age
    'hoppa över', // class
    'hoppa över', // assessment
    'hoppa över', // quiet hours
    'hoppa över', // grade
  ]);

  const profile = await runStudentSetup({
    interactionId: 'setup-3',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 3000,
  });

  assert.equal(profile.displayName, 'Ada');
  assert.equal(profile.course?.code, 'Ma3c');
  assert.deepEqual(profile.lessonSlots, []);
  assert.equal(profile.age, null);
  assert.equal(profile.previousGrade, null);
  // Quiet hours are never left undefined: the default protects the evening.
  assert.deepEqual(profile.quietHours, { start: '21:00', end: '07:00' });
  stop();
});

test('an unreadable answer is asked about once, then let go', async () => {
  const { messaging, inbox, stop } = harness([
    'Ada',
    'öhh', // course, first attempt
    'Ma1c', // course, after the retry
    'Exponent 1c',
    'ekvationer',
    'hoppa över',
    'okej',
    'hoppa över',
    'hoppa över',
    'hoppa över',
    'hoppa över',
    'hoppa över',
    'hoppa över',
  ]);

  const profile = await runStudentSetup({
    interactionId: 'setup-4',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 3000,
  });

  assert.equal(profile.course?.code, 'Ma1c');
  const retry = messaging.sent.find((sent) =>
    sent.text.includes('Skriv den som den står i schemat'),
  );
  assert.ok(retry, 'the retry prompt was sent exactly once');
  assert.equal(
    messaging.sent.filter((sent) => sent.text.includes('står i schemat'))
      .length,
    1,
  );
  stop();
});

test('silence ends setup instead of hanging on it', async () => {
  const { messaging, inbox, stop } = harness([]);

  await assert.rejects(
    runStudentSetup({
      interactionId: 'setup-5',
      conversationId: CONVERSATION,
      messaging,
      inbox,
      timeoutMs: 40,
    }),
    OnboardingAbandoned,
  );
  stop();
});

test('the summary repeats back what was understood, so a mistake is visible', () => {
  const text = summarise({
    displayName: 'William',
    schoolYear: 2,
    age: 17,
    className: 'NA22B',
    course: { code: 'Ma2c', raw: 'Ma2c' },
    textbook: 'Matematik 5000+ 2c',
    currentTopic: 'andragradsekvationer',
    selfAssessedLevel: 'struggling',
    previousGrade: 'C',
    lessonSlots: [{ weekday: 'tuesday', startsAt: '09:15' }],
    nextAssessment: { date: '2026-10-03', note: null },
    quietHours: { start: '21:00', end: '07:00' },
    timezone: 'Europe/Stockholm',
    language: 'sv',
    updatedAt: new Date().toISOString(),
  });

  assert.match(text, /William/);
  assert.match(text, /Ma2c/);
  assert.match(text, /Matematik 5000\+ 2c/);
  assert.match(text, /tis 09:15/);
  assert.match(text, /21:00 och 07:00/);
  assert.match(text, /Stämmer det inte/);
});

test('answers sent in one burst are all read, in order', async () => {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const controller = new AbortController();
  void inbox.pump(messaging, controller.signal);

  // Everything arrives before the first question has even gone out.
  for (const answer of [
    'William',
    'Ma2c',
    'Matematik 5000+ 2c',
    'andragradsekvationer',
    'tis 9.15',
    'okej',
    'tvåan',
    'hoppa över',
    'hoppa över',
    'hoppa över',
    'hoppa över',
    'hoppa över',
  ]) {
    messaging.deliver(CONVERSATION, answer);
  }

  const profile = await runStudentSetup({
    interactionId: 'setup-burst',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 3000,
  });

  assert.equal(profile.displayName, 'William');
  assert.equal(profile.course?.code, 'Ma2c');
  assert.equal(profile.textbook, 'Matematik 5000+ 2c');
  assert.equal(profile.schoolYear, 2);
  controller.abort();
});
