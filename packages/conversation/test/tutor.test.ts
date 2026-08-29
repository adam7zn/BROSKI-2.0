import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { searchPages, tokenise } from '../src/tutor/retrieval.js';
import { runTutorTurn } from '../src/tutor/tutor.js';

const pages = [
  {
    id: 'p84',
    label: 's. 84',
    text: 'Andragradsekvationer på formen x^2 + px + q = 0 löses med pq-formeln.',
  },
  {
    id: 'p85',
    label: 's. 85',
    text: 'Exempel: lös x^2 - 6x + 8 = 0 med pq-formeln. Ekvationen har två rötter.',
  },
  {
    id: 'p20',
    label: 's. 20',
    text: 'Linjära ekvationer löses genom att göra samma sak på båda sidor.',
  },
];

function stubClient(
  output: { covered: boolean; answer: string; usedPages: string[] },
  onPrompt?: (prompt: string) => void,
) {
  return {
    messages: {
      parse: async (params: { messages: Array<{ content: string }> }) => {
        onPrompt?.(String(params.messages[0]?.content ?? ''));
        return { parsed_output: output };
      },
    },
  } as unknown as Anthropic;
}

test('common words do not decide which page is relevant', () => {
  assert.deepEqual(tokenise('Hur kan jag lösa det här?'), ['lösa']);
});

test('a hyphenated term survives whole, and as its parts', () => {
  // "pq-formeln" is the telling word; splitting it away would lose the search.
  assert.deepEqual(tokenise('hur funkar pq-formeln?'), [
    'funkar',
    'pq-formeln',
    'formeln',
  ]);
});

test('a Swedish compound counts for the word inside it', () => {
  const found = searchPages(
    [
      {
        id: 'a',
        label: 'A',
        text: 'Andragradsekvationer löses med pq-formeln.',
      },
      { id: 'b', label: 'B', text: 'Trianglar har tre hörn.' },
    ],
    'ekvationer',
  );
  assert.equal(found[0]?.label, 'A');
});

test('the page about the question ranks first', () => {
  const found = searchPages(pages, 'hur funkar pq-formeln?');
  assert.equal(found[0]?.label, 's. 84');
  assert.ok(found.some((page) => page.label === 's. 85'));
  // The unrelated page is not offered at all.
  assert.ok(!found.some((page) => page.label === 's. 20'));
});

test('the page matching both terms wins over one matching a rarer single term', () => {
  // "ekvationer" appears literally only on the linear-equations page, but the
  // pq-formeln page matches both terms and has to come first.
  const found = searchPages(pages, 'ekvationer pq-formeln');
  assert.equal(found[0]?.label, 's. 84');
  assert.equal(found.at(-1)?.label, 's. 20');
});

test('a question about nothing in the book finds no pages', () => {
  assert.deepEqual(searchPages(pages, 'integraler och derivator'), []);
});

test('only the pages retrieval found are put in front of the model', async () => {
  const prompts: string[] = [];
  await runTutorTurn({
    question: 'hur gör jag med pq-formeln?',
    pages,
    client: stubClient(
      {
        covered: true,
        answer: 'Börja med att halvera p.',
        usedPages: ['s. 84'],
      },
      (prompt) => prompts.push(prompt),
    ),
  });

  assert.match(prompts[0]!, /s\. 84/);
  // The page about linear equations was never sent.
  assert.ok(!prompts[0]!.includes('s. 20'));
});

test('a page the model claims but never saw is dropped', async () => {
  const turn = await runTutorTurn({
    question: 'pq-formeln?',
    pages,
    client: stubClient({
      covered: true,
      answer: 'Se sidan om derivator.',
      // Neither page was offered for this question.
      usedPages: ['s. 20', 's. 300'],
    }),
  });

  assert.deepEqual(turn.usedPages, []);
  assert.deepEqual(turn.consideredPages, ['s. 84', 's. 85']);
});

test('a question outside the book is not answered from general knowledge', async () => {
  const turn = await runTutorTurn({
    question: 'förklara integraler',
    pages,
    client: stubClient({
      // Even if the model claims coverage, nothing was retrieved to cover it.
      covered: true,
      answer: 'En integral är arean under kurvan.',
      usedPages: ['s. 84'],
    }),
  });

  assert.equal(turn.covered, false);
  assert.deepEqual(turn.consideredPages, []);
});

test('with no book at all it says so instead of guessing', async () => {
  const turn = await runTutorTurn({
    question: 'hur löser jag x^2 = 9?',
    pages: [],
    client: stubClient({ covered: true, answer: 'x = 3', usedPages: [] }),
  });

  assert.equal(turn.covered, false);
  assert.match(turn.answer, /ingen bok inlagd/);
});

test('a follow-up finds the page the conversation is about', async () => {
  const prompts: string[] = [];
  await runTutorTurn({
    question: 'och sen då?',
    history: [
      { role: 'student', text: 'jag fastnade på pq-formeln' },
      { role: 'companion', text: 'Halvera p först.' },
    ],
    pages,
    client: stubClient(
      { covered: true, answer: 'Kvadrera det.', usedPages: ['s. 84'] },
      (prompt) => prompts.push(prompt),
    ),
  });

  // "och sen då?" alone matches nothing; the history is what finds the page.
  assert.match(prompts[0]!, /s\. 84/);
});
