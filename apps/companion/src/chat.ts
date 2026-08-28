import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { FakeMessagingProvider, ReplyInbox, runInteraction } from '@msc/conversation';

import { readConfig } from './config.js';
import { buildAgent, openStore, planNextInteraction } from './wire.js';

/**
 * The whole loop in a terminal, with the messaging provider faked.
 *
 * Same code path as Telegram — only the transport differs.
 */
async function main(): Promise<void> {
  const config = readConfig();
  const store = openStore(config);
  const agent = buildAgent(config);
  const messaging = new FakeMessagingProvider();
  const inbox = new ReplyInbox();
  const conversationId = 'local-chat';

  const controller = new AbortController();
  void inbox.pump(messaging, controller.signal);

  // An async iterator rather than `question()`, so a piped stdin (scripts, CI)
  // behaves the same as a person typing.
  const readline = createInterface({ input: stdin, output: stdout });
  const lines = readline[Symbol.asyncIterator]();

  try {
    const planned = planNextInteraction(store, config, conversationId);
    console.log(`\nStudying "${planned.item.topic}" — ${planned.reason}.`);
    console.log(`Interaction ${planned.context.interactionId}\n`);

    const interaction = runInteraction({
      context: planned.context,
      conversationId,
      agent,
      messaging,
      inbox,
      replyTimeoutMs: config.replyTimeoutMs,
      signal: controller.signal,
    });

    // Wait for the question to actually be sent before prompting.
    const question = await waitForSent(messaging, 1);
    console.log(`Companion: ${question}\n`);

    stdout.write('You: ');
    const line = await lines.next();
    if (line.done) {
      console.log('\nNo answer given.');
      controller.abort();
      return;
    }
    messaging.deliver(conversationId, line.value);

    const outcome = await interaction;
    if (outcome.status === 'no_reply') {
      console.log('\nNo reply — nothing was stored as an attempt.');
      store.saveOutcome(outcome);
      return;
    }

    console.log(`\nCompanion: ${outcome.evaluation.feedback}`);
    console.log(
      `\n[${outcome.result.result} · confidence ${outcome.evaluation.confidence.toFixed(2)}` +
        `${outcome.evaluation.deterministic ? ' · deterministic' : ''}]`,
    );
    store.saveOutcome(outcome);
    console.log('Saved. Run "npm run inspect" to see the record.');
  } finally {
    readline.close();
    controller.abort();
    store.close();
  }
}

async function waitForSent(
  messaging: FakeMessagingProvider,
  count: number,
): Promise<string> {
  while (messaging.sent.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return messaging.sent[count - 1]!.text;
}

await main();
