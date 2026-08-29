import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { ModelCallError } from '../src/agent/model-call.js';
import { ReplyInbox } from '../src/inbox.js';
import { FakeMessagingProvider } from '../src/messaging/fake.js';
import { runSmartSetup } from '../src/onboarding/smart-setup.js';

const CONVERSATION = 'chat-1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Turn {
  learned: Record<string, unknown>;
  message: string;
  done: boolean;
}

const nothing = {
  displayName: null,
  course: null,
  textbook: null,
  currentTopic: null,
  lessonTimes: null,
  selfAssessedLevel: null,
  schoolYear: null,
  age: null,
  className: null,
  nextAssessmentDate: null,
  nextAssessmentNote: null,
  quietHours: null,
  previousGrade: null,
};

/** A client that replays scripted turns, and records what it was asked. */
function stubClient(turns: Turn[], onCall?: (prompt: string) => void) {
  return {
    messages: {
      parse: async (params: { messages: Array<{ content: string }> }) => {
        onCall?.(String(params.messages[0]?.content ?? ''));
        const turn = turns.shift();
        if (!turn) throw new Error('the stub ran out of turns');
        return {
          parsed_output: { ...turn, learned: { ...nothing, ...turn.learned } },
        };
      },
    },
  } as unknown as Anthropic;
}

function harness(studentMessages: string[]) {
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const controller = new AbortController();
  void inbox.pump(messaging, controller.signal);

  let sent = 0;
  void (async () => {
    while (sent < studentMessages.length && !controller.signal.aborted) {
      while (messaging.sent.length < sent + 1 && !controller.signal.aborted) {
        await sleep(2);
      }
      if (controller.signal.aborted) return;
      await sleep(2);
      messaging.deliver(CONVERSATION, studentMessages[sent]!);
      sent += 1;
    }
  })();

  return { messaging, inbox, stop: () => controller.abort() };
}

test('several answers in one sentence are all taken at once', async () => {
  const { messaging, inbox, stop } = harness([
    'jag heter William, går tvåan och läser matte 2c med 5000+',
    'ja',
  ]);

  const profile = await runSmartSetup({
    interactionId: 'smart-1',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 2000,
    client: stubClient([
      {
        learned: {
          displayName: 'William',
          schoolYear: 2,
          course: 'matte 2c',
          textbook: 'Matematik 5000+',
        },
        message:
          'Har du planeringen från skolan? Fota den så slipper du skriva.',
        done: false,
      },
      { learned: {}, message: 'Toppen, då kör vi.', done: true },
    ]),
  });

  assert.equal(profile.displayName, 'William');
  assert.equal(profile.schoolYear, 2);
  // Free text from the model is normalised by the same reader the
  // questionnaire uses, not taken on the model's word.
  assert.equal(profile.course?.code, 'Ma2c');
  assert.equal(profile.textbook, 'Matematik 5000+');
  stop();
});

test('it is told what it already knows, so it stops asking', async () => {
  const prompts: string[] = [];
  const { messaging, inbox, stop } = harness(['William', 'ok']);

  await runSmartSetup({
    interactionId: 'smart-2',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 2000,
    client: stubClient(
      [
        {
          learned: { displayName: 'William', course: 'Ma2c' },
          message: 'Vilken bok?',
          done: false,
        },
        { learned: {}, message: 'Klart.', done: true },
      ],
      (prompt) => prompts.push(prompt),
    ),
  });

  assert.match(prompts[0]!, /name: not known/);
  // By the second call the name and course are known and said to be known.
  assert.match(prompts[1]!, /name: William/);
  assert.match(prompts[1]!, /course: Ma2c/);
  stop();
});

test('a schedule in free text becomes real lesson slots', async () => {
  const { messaging, inbox, stop } = harness(['tis 9.15 och tors 13']);

  const profile = await runSmartSetup({
    interactionId: 'smart-3',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 2000,
    client: stubClient([
      {
        learned: { displayName: 'Ada', lessonTimes: 'tis 9.15 och tors 13' },
        message: 'Tack!',
        done: true,
      },
    ]),
  });

  assert.deepEqual(profile.lessonSlots, [
    { weekday: 'tuesday', startsAt: '09:15' },
    { weekday: 'thursday', startsAt: '13:00' },
  ]);
  stop();
});

test('a vague time is not turned into a schedule', async () => {
  const { messaging, inbox, stop } = harness(['typ mitt i veckan nångång']);

  const profile = await runSmartSetup({
    interactionId: 'smart-4',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 2000,
    client: stubClient([
      {
        learned: {
          displayName: 'Ada',
          lessonTimes: 'typ mitt i veckan nångång',
        },
        message: 'Okej.',
        done: true,
      },
    ]),
  });

  assert.deepEqual(profile.lessonSlots, []);
  stop();
});

test('the conversation ends with a summary the student can correct', async () => {
  const { messaging, inbox, stop } = harness(['William']);

  await runSmartSetup({
    interactionId: 'smart-5',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 2000,
    client: stubClient([
      {
        learned: { displayName: 'William' },
        message: 'Då kör vi.',
        done: true,
      },
    ]),
  });

  const last = messaging.sent.at(-1)!.text;
  assert.match(last, /Då har jag det här om dig, William/);
  assert.match(last, /Stämmer det inte/);
  stop();
});

test('a model failure is explained to the student, not swallowed', async () => {
  const { messaging, inbox, stop } = harness(['William']);
  const failing = {
    messages: {
      parse: async () => {
        throw new ModelCallError('setup', 401, 'invalid x-api-key');
      },
    },
  } as unknown as Anthropic;

  await assert.rejects(
    runSmartSetup({
      interactionId: 'smart-6',
      conversationId: CONVERSATION,
      messaging,
      inbox,
      timeoutMs: 2000,
      client: failing,
    }),
    ModelCallError,
  );

  const last = messaging.sent.at(-1)!.text;
  assert.match(last, /nyckeln verkar fel/);
  // The API's own words never reach the student.
  assert.ok(!last.includes('x-api-key'));
  stop();
});

test('silence ends setup instead of looping forever', async () => {
  const { messaging, inbox, stop } = harness([]);

  const profile = await runSmartSetup({
    interactionId: 'smart-7',
    conversationId: CONVERSATION,
    messaging,
    inbox,
    timeoutMs: 40,
    client: stubClient([]),
  });

  // Nothing was learned, but the profile is still valid and usable.
  assert.equal(profile.displayName, 'du');
  stop();
});
