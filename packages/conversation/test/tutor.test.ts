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

type ContentBlock = { type: string; text?: string };

interface TutorOutput {
  covered: boolean;
  exercise: string | null;
  message: string;
  steps: string[];
  question: string | null;
  usedPages: string[];
}

function stubClient(
  output: Partial<TutorOutput> & { covered: boolean; message: string },
  onContent?: (content: ContentBlock[]) => void,
) {
  const parsed: TutorOutput = {
    exercise: null,
    steps: [],
    question: null,
    usedPages: [],
    ...output,
  };
  return {
    messages: {
      parse: async (params: {
        messages: Array<{ content: ContentBlock[] }>;
      }) => {
        onContent?.(params.messages[0]?.content ?? []);
        return { parsed_output: parsed };
      },
    },
  } as unknown as Anthropic;
}

/** Everything the model was told in words, as one string. */
function textOf(content: ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
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
        message: 'Börja med att halvera p.',
        usedPages: ['s. 84'],
      },
      (content) => prompts.push(textOf(content)),
    ),
  });

  assert.match(prompts[0]!, /s\. 84/);
  // The page about linear equations is named in the catalogue, but what it
  // says was never sent.
  assert.ok(!prompts[0]!.includes('Linjära ekvationer löses'));
});

test('a page the model claims but never saw is dropped', async () => {
  const turn = await runTutorTurn({
    question: 'pq-formeln?',
    pages,
    client: stubClient({
      covered: true,
      message: 'Se sidan om derivator.',
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
      message: 'En integral är arean under kurvan.',
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
    client: stubClient({ covered: true, message: 'x = 3', usedPages: [] }),
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
      { covered: true, message: 'Kvadrera det.', usedPages: ['s. 84'] },
      (content) => prompts.push(textOf(content)),
    ),
  });

  // "och sen då?" alone matches nothing; the history is what finds the page.
  assert.match(prompts[0]!, /s\. 84/);
});

test('a page just photographed is used even when the words match nothing', async () => {
  const prompts: string[] = [];
  const photographed = {
    id: 'upload:abc',
    label: 'Uppgifter 1117–1129',
    text: '1117 a) x(x - 3)  b) x^3(2 - 3x)  1118 a) (x + 3)(x + 7)',
  };

  const turn = await runTutorTurn({
    // Nothing here matches the page: no keyword overlap at all.
    question: 'hur löser jag första frågan',
    pages,
    pinned: [photographed],
    client: stubClient(
      {
        covered: true,
        message: 'Börja med att multiplicera in x i parentesen.',
        usedPages: ['Uppgifter 1117–1129'],
      },
      (content) => prompts.push(textOf(content)),
    ),
  });

  assert.match(prompts[0]!, /Uppgifter 1117/);
  assert.match(prompts[0]!, /x\(x - 3\)/);
  // The page counts as used, because it really was in front of the model.
  assert.deepEqual(turn.usedPages, ['Uppgifter 1117–1129']);
  assert.equal(turn.covered, true);
});

test('a photographed page works even with no book indexed at all', async () => {
  const turn = await runTutorTurn({
    question: 'vad ska jag göra här',
    pages: [],
    pinned: [{ id: 'upload:x', label: 'Uppgift 12', text: 'Lös 2x + 3 = 11.' }],
    client: stubClient({
      covered: true,
      message: 'Ta bort trean från båda sidor först.',
      usedPages: ['Uppgift 12'],
    }),
  });

  assert.equal(turn.covered, true);
  assert.match(turn.answer, /trean/);
});

test('the photo itself is put in front of the model, not only its text', async () => {
  const blocks: ContentBlock[] = [];
  const turn = await runTutorTurn({
    question: 'hur löser jag första frågan',
    pages,
    files: [
      {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/jpeg',
        fileName: 'sida.jpg',
      },
    ],
    client: stubClient(
      { covered: true, message: '1117 a: multiplicera in x.', usedPages: [] },
      (content) => blocks.push(...content),
    ),
  });

  // Reading the page into text loses which number is (a); the picture does not.
  assert.ok(blocks.some((block) => block.type === 'image'));
  assert.equal(turn.covered, true);
});

test('a photo alone is enough to answer, with no book indexed', async () => {
  const turn = await runTutorTurn({
    question: 'hjälp',
    pages: [],
    files: [
      {
        bytes: new Uint8Array([1]),
        mimeType: 'image/png',
        fileName: null,
      },
    ],
    client: stubClient({
      covered: true,
      message: 'Börja med att flytta över trean.',
      usedPages: [],
    }),
  });

  assert.equal(turn.covered, true);
  assert.doesNotMatch(turn.answer, /ingen bok inlagd/);
});

test('the book is searched with the words on the page just photographed', async () => {
  const prompts: string[] = [];
  await runTutorTurn({
    // Says nothing at all about which page teaches this.
    question: 'hjälp mig med den här',
    pages,
    pinned: [
      {
        id: 'upload:abc',
        label: 'Uppgift 1117',
        text: 'Lös ekvationen x^2 - 6x + 8 = 0 med pq-formeln.',
      },
    ],
    client: stubClient(
      { covered: true, message: 'Halvera p först.', usedPages: ['s. 84'] },
      (content) => prompts.push(textOf(content)),
    ),
  });

  // The photographed exercise names pq-formeln, so the page that teaches it
  // has to come along even though the student never typed the word.
  assert.match(prompts[0]!, /s\. 84/);
});

test('an unrelated page is still left out when the photo finds pages', async () => {
  const prompts: string[] = [];
  await runTutorTurn({
    question: 'hjälp mig',
    pages,
    pinned: [
      {
        id: 'upload:abc',
        label: 'Uppgift 1117',
        text: 'Lös x^2 - 6x + 8 = 0 med pq-formeln.',
      },
    ],
    client: stubClient(
      { covered: true, message: 'Halvera p.', usedPages: ['s. 84'] },
      (content) => prompts.push(textOf(content)),
    ),
  });

  assert.ok(!prompts[0]!.includes('Linjära ekvationer löses'));
});

test('the reply is laid out in parts, not as a wall of text', async () => {
  const turn = await runTutorTurn({
    question: 'lös första frågan',
    pages,
    pinned: [{ id: 'upload:abc', label: 'Uppgift 1117', text: 'x(x - 3)' }],
    client: stubClient({
      covered: true,
      exercise: '1117 a) x(x - 3)',
      message: 'Här multiplicerar du in x i parentesen.',
      steps: ['Ta x gånger varje term:\nx · x - x · 3', 'Förenkla varje term.'],
      question: 'Vad blir de två termerna?',
      usedPages: [],
    }),
  });

  assert.equal(
    turn.answer,
    [
      '1117 a) x(x - 3)',
      '',
      'Här multiplicerar du in x i parentesen.',
      '',
      '1. Ta x gånger varje term:',
      'x · x - x · 3',
      '2. Förenkla varje term.',
      '',
      'Vad blir de två termerna?',
    ].join('\n'),
  );
});

test('a reply with nothing to lay out is just the one line', async () => {
  const turn = await runTutorTurn({
    question: 'hej',
    pages,
    client: stubClient({
      covered: false,
      message: 'Hej! Vad har du fastnat på?',
    }),
  });

  assert.equal(turn.answer, 'Hej! Vad har du fastnat på?');
});

test('blank parts do not leave holes in the reply', async () => {
  const turn = await runTutorTurn({
    question: 'lös den',
    pages,
    client: stubClient({
      covered: true,
      exercise: '   ',
      message: 'Halvera p först.',
      steps: ['', '  ', 'Kvadrera hälften av p.'],
      question: '  ',
    }),
  });

  assert.equal(turn.answer, 'Halvera p först.\n\n1. Kvadrera hälften av p.');
});

test('it is told the name of every page read in, not only the ones retrieved', async () => {
  const prompts: string[] = [];
  await runTutorTurn({
    question: 'hjälp mig med uppgift 1117',
    pages,
    client: stubClient(
      {
        covered: false,
        message: 'Jag har s. 20-85 inlästa, och 1117 finns inte på någon.',
      },
      (content) => prompts.push(textOf(content)),
    ),
  });

  // "Not in your book" is only actionable when it can say what is in it.
  for (const page of pages) {
    assert.ok(
      prompts[0]!.includes(page.label),
      `${page.label} was missing from the catalogue`,
    );
  }
});

test('the catalogue names the page just photographed too', async () => {
  const prompts: string[] = [];
  await runTutorTurn({
    question: 'vad är det här',
    pages: [],
    pinned: [
      { id: 'upload:abc', label: 'Uppgifter 1117-1129', text: 'x(x - 3)' },
    ],
    client: stubClient(
      { covered: true, message: 'Det är multiplikation av polynom.' },
      (content) => prompts.push(textOf(content)),
    ),
  });

  assert.match(prompts[0]!, /Uppgifter 1117-1129/);
});
