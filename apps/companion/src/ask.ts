import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  ModelCallError,
  runTutorTurn,
  type TutorMessage,
} from '@math-study-companion/conversation';

import { readConfig } from './config.js';
import { openStore } from './wire.js';

/**
 * Free conversation about maths in the terminal, grounded in the indexed book:
 * `pnpm ask` for a back-and-forth, or `pnpm ask "hur gör jag med pq-formeln"`
 * for a single question.
 */
const config = readConfig();
const store = openStore(config);

try {
  if (!config.hasModelKey) {
    console.error('Answering needs ANTHROPIC_API_KEY in .env.');
    process.exit(1);
  }

  const pages = store.bookPages();
  if (pages.length === 0) {
    console.log(
      'No book pages indexed yet. Run "pnpm index-book <folder>" first, or\n' +
        'send photos of the pages to the bot.',
    );
  } else {
    console.log(`${pages.length} pages of your book indexed.\n`);
  }

  const history: TutorMessage[] = [];
  const single = process.argv.slice(2).join(' ').trim();

  const answer = async (question: string): Promise<void> => {
    try {
      const turn = await runTutorTurn({ question, history, pages });
      history.push({ role: 'student', text: question });
      history.push({ role: 'companion', text: turn.answer });
      console.log(`\nBroski: ${turn.answer}`);
      console.log(
        turn.covered
          ? `        [ur boken: ${turn.usedPages.join(', ') || 'ingen sida angiven'}]`
          : '        [inte i boken]',
      );
      // Which pages retrieval actually offered, so a wrong answer can be told
      // apart from a wrong search.
      console.log(
        `        [såg på: ${turn.consideredPages.join(', ') || 'inga sidor'}]`,
      );
    } catch (error) {
      if (error instanceof ModelCallError) {
        console.error(`\n${error.studentMessage}\n(${error.message})`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  };

  if (single !== '') {
    await answer(single);
  } else {
    const readline = createInterface({ input: stdin, output: stdout });
    try {
      stdout.write('Du: ');
      for await (const line of readline) {
        const question = line.trim();
        if (question === '') continue;
        if (question === 'sluta' || question === 'exit') break;
        await answer(question);
        stdout.write('\nDu: ');
      }
    } finally {
      readline.close();
    }
  }
} finally {
  store.close();
}
