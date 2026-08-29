import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  FakeMessagingProvider,
  ModelCallError,
  ReplyInbox,
  runInteraction,
} from '@math-study-companion/conversation';

import { readConfig } from './config.js';
import { ensureProfile } from './setup-gate.js';
import { buildAgent, openStore, planNextInteraction } from './wire.js';

/**
 * The whole conversation in a terminal, with the messaging provider faked.
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

  const readline = createInterface({ input: stdin, output: stdout });

  try {
    // Everything he types reaches the fake provider as it arrives, so setup and
    // the interaction that follows share one input stream.
    void (async () => {
      for await (const line of readline) {
        messaging.deliver(conversationId, line);
      }
      // Piped input ran out (or he pressed ctrl-D): stop waiting.
      controller.abort();
    })();

    const profile = await ensureProfile({
      store,
      config,
      conversationId,
      messaging,
      inbox,
      signal: controller.signal,
      onMessage: (entry) => {
        if (entry.role === 'companion') {
          stdout.write(`\nBroski: ${entry.text}\n\nDu: `);
        }
      },
    });
    console.log(`\n(profil: ${profile.displayName})`);

    const planned = planNextInteraction(store, config, conversationId, {
      force: process.argv.includes('--force'),
    });

    if (!planned.context) {
      console.log(`\nNothing to send: ${planned.decision.reason}.`);
      console.log('Run with --force to ask something anyway.');
      return;
    }

    console.log(
      `\n[${planned.decision.mode}] ${planned.context.topic} — ${planned.decision.reason}.`,
    );
    console.log(`Interaction ${planned.context.interactionId}\n`);

    const outcome = await runInteraction({
      context: planned.context,
      conversationId,
      agent,
      messaging,
      inbox,
      replyTimeoutMs: config.replyTimeoutMs,
      signal: controller.signal,
      onMessage: (entry) => {
        if (entry.role === 'companion') {
          stdout.write(`\nCompanion: ${entry.text}\n\nYou: `);
        }
      },
    });

    store.saveOutcome(outcome);

    if (outcome.status === 'no_reply') {
      console.log('\nNo reply — nothing was stored as an attempt.');
      return;
    }

    console.log(
      `\n[${outcome.result.result} · confidence ${outcome.final.confidence.toFixed(2)}` +
        `${outcome.final.deterministic ? ' · deterministic' : ''}` +
        `${outcome.trace.hintsGiven ? ` · ${outcome.trace.hintsGiven} hint(s)` : ''}]`,
    );
    console.log('Saved. Run "pnpm inspect" to see the record.');
  } catch (error) {
    if (error instanceof ModelCallError) {
      console.error(`\nStopped: ${error.message}`);
      if (error.status === 401 || error.status === 403) {
        console.error('Check ANTHROPIC_API_KEY in .env.');
      }
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    readline.close();
    controller.abort();
    store.close();
  }
}

await main();
