import { readConfig } from './config.js';
import { openStore } from './wire.js';

/** The minimal operational view: what was asked, answered, and judged. */
const config = readConfig();
const store = openStore(config);

try {
  const interactions = store.recentInteractions(20);
  if (interactions.length === 0) {
    console.log('No interactions yet.');
  }

  for (const interaction of interactions) {
    console.log(`\n${interaction.createdAt}  ${interaction.id}`);
    console.log(`  topic     ${interaction.topic} (${interaction.difficulty})`);
    console.log(`  why       ${interaction.mode}: ${interaction.reason}`);
    console.log(`  status    ${interaction.status}`);
    if (interaction.question) console.log(`  asked     ${interaction.question}`);
    if (interaction.studentReply) console.log(`  replied   ${interaction.studentReply}`);
    if (interaction.result) {
      const confidence = interaction.confidence?.toFixed(2) ?? '—';
      const turns = interaction.studentTurns ?? 1;
      const hints = interaction.hintsGiven ?? 0;
      console.log(
        `  judged    ${interaction.result} (confidence ${confidence}, ` +
          `${turns} turn(s), ${hints} hint(s))`,
      );
    }
    if (interaction.feedback) console.log(`  feedback  ${interaction.feedback}`);
  }
} finally {
  store.close();
}
