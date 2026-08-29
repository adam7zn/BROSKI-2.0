import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StudentProfile } from '@math-study-companion/contracts';
import type { DocumentReading } from '@math-study-companion/conversation';

import { applyDocument, slug } from '../src/apply-document.js';

const profile: StudentProfile = {
  displayName: 'William',
  schoolYear: 2,
  age: 17,
  className: 'NA22B',
  course: { code: 'Ma2c', raw: 'Ma2c' },
  textbook: 'Matematik 5000+ 2c',
  currentTopic: 'andragradsekvationer',
  selfAssessedLevel: 'struggling',
  previousGrade: null,
  // 2026-09-15 is a Tuesday, 2026-09-17 a Thursday.
  lessonSlots: [
    { weekday: 'tuesday', startsAt: '09:15' },
    { weekday: 'thursday', startsAt: '13:00' },
  ],
  nextAssessment: null,
  quietHours: { start: '21:00', end: '07:00' },
  timezone: 'Europe/Stockholm',
  language: 'sv',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const emptyContext = {
  profile,
  coursePlan: {
    courseName: 'Matematik',
    timezone: 'Europe/Stockholm',
    lessons: [],
  },
  studyItems: [],
  today: new Date('2026-09-01T00:00:00Z'),
};

function reading(overrides: Partial<DocumentReading> = {}): DocumentReading {
  return {
    kind: 'course_plan',
    summary: 'Planering Ma2c v. 38',
    courseName: 'Ma2c',
    rows: [],
    extractedText: null,
    confidence: 0.9,
    ...overrides,
  };
}

test('a term plan becomes dated lessons that know what they cover', () => {
  const result = applyDocument(
    reading({
      rows: [
        {
          date: '2026-09-15',
          whenText: 'tis 15/9',
          topic: 'Andragradsekvationer, pq-formeln',
          reference: 's. 84-90',
          isAssessment: false,
        },
        {
          date: '2026-09-17',
          whenText: 'tors 17/9',
          topic: 'Faktorsatsen',
          reference: null,
          isAssessment: false,
        },
      ],
    }),
    emptyContext,
  );

  const lessons = result.coursePlan?.lessons ?? [];
  assert.equal(lessons.length, 2);
  // The time comes from the timetable the student already gave.
  assert.equal(lessons[0]?.startsAt, '2026-09-15 09:15');
  assert.equal(lessons[1]?.startsAt, '2026-09-17 13:00');
  // This is the mapping the planner could never work out on its own.
  assert.deepEqual(lessons[0]?.covers, ['andragradsekvationer-pq-formeln']);
  assert.equal(result.studyItems.length, 2);
  assert.match(
    result.studyItems[0]!.sourceText,
    /Andragradsekvationer, pq-formeln\. Enligt planeringen: s\. 84-90\./,
  );
});

test('a day with no lesson time falls back rather than inventing one', () => {
  // 2026-09-16 is a Wednesday, and he has no Wednesday lesson.
  const result = applyDocument(
    reading({
      rows: [
        {
          date: '2026-09-16',
          whenText: 'ons',
          topic: 'Repetition',
          reference: null,
          isAssessment: false,
        },
      ],
    }),
    emptyContext,
  );
  assert.equal(result.coursePlan?.lessons[0]?.startsAt, '2026-09-16 08:00');
});

test('rows without a date become topics, never guessed dates', () => {
  const result = applyDocument(
    reading({
      rows: [
        {
          date: null,
          whenText: 'v. 40',
          topic: 'Logaritmer',
          reference: 'kap 3',
          isAssessment: false,
        },
      ],
    }),
    emptyContext,
  );

  assert.equal(result.coursePlan, null);
  assert.equal(result.undated.length, 1);
  // The topic is still worth having, even with nowhere to put it.
  assert.equal(result.studyItems.length, 1);
  assert.equal(result.studyItems[0]?.id, 'logaritmer');
  assert.match(result.message, /saknade datum/);
});

test('a test in the plan becomes the next assessment', () => {
  const result = applyDocument(
    reading({
      rows: [
        {
          date: '2026-10-06',
          whenText: 'tis 6/10',
          topic: 'Prov kap 2',
          reference: null,
          isAssessment: true,
        },
        {
          date: '2026-09-15',
          whenText: 'tis 15/9',
          topic: 'Genomgång',
          reference: null,
          isAssessment: false,
        },
      ],
    }),
    emptyContext,
  );
  assert.equal(result.nextAssessment?.date, '2026-10-06');
  assert.equal(result.nextAssessment?.note, 'Prov kap 2');
});

test('a test that has already been is not the next one', () => {
  const result = applyDocument(
    reading({
      rows: [
        {
          date: '2026-08-01',
          whenText: null,
          topic: 'Prov kap 1',
          reference: null,
          isAssessment: true,
        },
      ],
    }),
    emptyContext,
  );
  assert.equal(result.nextAssessment, null);
});

test('a new plan updates the lessons it names and keeps the rest', () => {
  const result = applyDocument(
    reading({
      rows: [
        {
          date: '2026-09-15',
          whenText: null,
          topic: 'Nytt innehåll',
          reference: null,
          isAssessment: false,
        },
      ],
    }),
    {
      ...emptyContext,
      coursePlan: {
        courseName: 'Ma2c',
        timezone: 'Europe/Stockholm',
        lessons: [
          {
            id: 'old-1',
            startsAt: '2026-09-15 09:15',
            topic: 'Gammalt innehåll',
            covers: [],
            prepares: [],
          },
          {
            id: 'old-2',
            startsAt: '2026-09-22 09:15',
            topic: 'Orörd lektion',
            covers: [],
            prepares: [],
          },
        ],
      },
    },
  );

  const lessons = result.coursePlan?.lessons ?? [];
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0]?.topic, 'Nytt innehåll');
  assert.equal(lessons[1]?.topic, 'Orörd lektion');
});

test('an assignment becomes something to practise on, not a calendar', () => {
  const result = applyDocument(
    reading({
      kind: 'assignment',
      summary: 'Uppgift 2115',
      rows: [],
      extractedText: 'Lös ekvationen x^2 - 6x + 8 = 0.',
    }),
    emptyContext,
  );

  assert.equal(result.coursePlan, null);
  assert.equal(result.studyItems.length, 1);
  assert.equal(
    result.studyItems[0]?.sourceText,
    'Lös ekvationen x^2 - 6x + 8 = 0.',
  );
  assert.match(result.message, /Sparat/);
});

test('an unreadable photo changes nothing and says so plainly', () => {
  const result = applyDocument(
    reading({ kind: 'unreadable', rows: [], confidence: 0.1 }),
    emptyContext,
  );
  assert.equal(result.coursePlan, null);
  assert.equal(result.studyItems.length, 0);
  assert.match(result.message, /bättre ljus/);
});

test('a hard-to-read plan is used, but the student is warned', () => {
  const result = applyDocument(
    reading({
      confidence: 0.4,
      rows: [
        {
          date: '2026-09-15',
          whenText: null,
          topic: 'Något',
          reference: null,
          isAssessment: false,
        },
      ],
    }),
    emptyContext,
  );
  assert.match(result.message, /svårläst/);
});

test('topics become stable ids that survive Swedish characters', () => {
  assert.equal(
    slug('Andragradsekvationer, pq-formeln'),
    'andragradsekvationer-pq-formeln',
  );
  assert.equal(slug('Räta linjens ekvation'), 'rata-linjens-ekvation');
  assert.equal(slug('!!!'), 'amne');
});
