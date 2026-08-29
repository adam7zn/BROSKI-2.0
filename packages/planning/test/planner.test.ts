import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lessonStart, type CoursePlan } from '../src/course-plan.js';
import { planStudySession } from '../src/planner.js';
import {
  reviewStateFor,
  reviewStates,
  type AttemptRecord,
} from '../src/review.js';
import type { StudyItem } from '../src/study-plan.js';

const items: StudyItem[] = [
  {
    id: 'balance',
    topic: 'balans',
    sourceText: 'a',
    difficulty: 'easy',
    image: null,
  },
  {
    id: 'parens',
    topic: 'parenteser',
    sourceText: 'b',
    difficulty: 'medium',
    image: null,
  },
  {
    id: 'quadratic',
    topic: 'andragrad',
    sourceText: 'c',
    difficulty: 'medium',
    image: null,
  },
];

const plan: CoursePlan = {
  courseName: 'Matematik',
  timezone: 'Europe/Stockholm',
  lessons: [
    {
      id: 'past',
      startsAt: '2026-09-14 09:15',
      topic: 'Parenteser',
      covers: ['parens'],
      prepares: [],
    },
    {
      id: 'soon',
      startsAt: '2026-09-15 13:00',
      topic: 'Andragradsekvationer',
      covers: ['quadratic'],
      prepares: ['parens'],
    },
  ],
};

const attempt = (
  studyItemId: string,
  result: AttemptRecord['result'],
  at: string,
): AttemptRecord => ({ studyItemId, result, at });

test('a lesson tomorrow makes the companion prepare its prerequisite', () => {
  const onlySoon: CoursePlan = { ...plan, lessons: [plan.lessons[1]!] };

  // 29 hours before the lesson is too far out to prime anything.
  const early = planStudySession({
    now: new Date('2026-09-14T06:00:00Z'),
    plan: onlySoon,
    items,
    reviews: new Map(),
  });
  assert.notEqual(early.mode, 'PREPARE');

  // The evening before is inside the window.
  const decision = planStudySession({
    now: new Date('2026-09-14T18:00:00Z'),
    plan: onlySoon,
    items,
    reviews: new Map(),
  });
  assert.equal(decision.mode, 'PREPARE');
  assert.equal(decision.item?.id, 'parens');
  assert.equal(decision.lessonId, 'soon');
  assert.match(decision.reason, /Andragradsekvationer" starts in 17 hours/);
});

test('just after a lesson it practises what that lesson taught', () => {
  const decision = planStudySession({
    now: new Date('2026-09-14T09:00:00Z'), // hours after the 09:15 local lesson
    plan,
    items,
    reviews: new Map(),
    prepareWindowHours: 2,
  });
  assert.equal(decision.mode, 'PRACTISE');
  assert.equal(decision.item?.id, 'parens');
  assert.match(decision.reason, /Parenteser" was 2 hours ago/);
});

test('away from lessons it reviews what the record says is due', () => {
  const reviews = reviewStates([
    attempt('balance', 'incorrect', '2026-09-01T10:00:00Z'),
    attempt('parens', 'correct', '2026-09-10T10:00:00Z'),
    attempt('quadratic', 'correct', '2026-09-10T10:00:00Z'),
  ]);
  const decision = planStudySession({
    now: new Date('2026-09-11T10:00:00Z'),
    plan,
    items,
    reviews,
  });
  assert.equal(decision.mode, 'REVIEW');
  // Wrong ten days ago, due one day later: the most overdue thing there is.
  assert.equal(decision.item?.id, 'balance');
  assert.match(decision.reason, /went badly .* due for review/);
});

test('nothing due and no lesson nearby means no message at all', () => {
  const reviews = reviewStates(
    items.map((item) => attempt(item.id, 'correct', '2026-09-11T10:00:00Z')),
  );
  const decision = planStudySession({
    now: new Date('2026-09-11T12:00:00Z'),
    plan,
    items,
    reviews,
  });
  assert.equal(decision.mode, 'NO_ACTION');
  assert.equal(decision.item, null);
  assert.match(decision.reason, /nothing is due/);
});

test('within a mode, the weakest item goes first', () => {
  const lesson: CoursePlan = {
    ...plan,
    lessons: [
      {
        id: 'multi',
        startsAt: '2026-09-15 13:00',
        topic: 'Repetition',
        covers: [],
        prepares: ['balance', 'parens'],
      },
    ],
  };
  const reviews = reviewStates([
    attempt('balance', 'correct', '2026-09-10T10:00:00Z'),
    attempt('parens', 'incorrect', '2026-09-10T10:00:00Z'),
  ]);
  const decision = planStudySession({
    now: new Date('2026-09-14T18:00:00Z'),
    plan: lesson,
    items,
    reviews,
  });
  assert.equal(decision.mode, 'PREPARE');
  assert.equal(decision.item?.id, 'parens');
});

test('lesson times follow the course timezone across a DST change', () => {
  const summer = lessonStart(
    {
      id: 's',
      startsAt: '2026-07-01 09:15',
      topic: '',
      covers: [],
      prepares: [],
    },
    'Europe/Stockholm',
  );
  const winter = lessonStart(
    {
      id: 'w',
      startsAt: '2026-12-01 09:15',
      topic: '',
      covers: [],
      prepares: [],
    },
    'Europe/Stockholm',
  );
  assert.equal(summer.toISOString(), '2026-07-01T07:15:00.000Z'); // UTC+2
  assert.equal(winter.toISOString(), '2026-12-01T08:15:00.000Z'); // UTC+1
});

test('review intervals grow while he is right and collapse when he is not', () => {
  const grow = reviewStateFor([
    attempt('balance', 'correct', '2026-09-01T10:00:00Z'),
    attempt('balance', 'correct', '2026-09-02T10:00:00Z'),
    attempt('balance', 'correct', '2026-09-04T10:00:00Z'),
  ]);
  assert.equal(grow?.intervalDays, 4);
  assert.equal(grow?.streak, 3);

  const collapse = reviewStateFor([
    attempt('balance', 'correct', '2026-09-01T10:00:00Z'),
    attempt('balance', 'correct', '2026-09-02T10:00:00Z'),
    attempt('balance', 'incorrect', '2026-09-04T10:00:00Z'),
  ]);
  assert.equal(collapse?.intervalDays, 1);
  assert.equal(collapse?.streak, 0);
});

test('an unreadable answer changes nothing about the schedule', () => {
  const before = reviewStateFor([
    attempt('balance', 'correct', '2026-09-01T10:00:00Z'),
    attempt('balance', 'correct', '2026-09-02T10:00:00Z'),
  ]);
  const after = reviewStateFor([
    attempt('balance', 'correct', '2026-09-01T10:00:00Z'),
    attempt('balance', 'correct', '2026-09-02T10:00:00Z'),
    attempt('balance', 'unclear', '2026-09-03T10:00:00Z'),
  ]);
  assert.equal(after?.intervalDays, before?.intervalDays);
  assert.equal(after?.streak, before?.streak);
});

test('the interval is capped so nothing disappears for good', () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    attempt(
      'balance',
      'correct',
      `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
    ),
  );
  assert.equal(reviewStateFor(many)?.intervalDays, 21);
});

test('an item never attempted has no review state', () => {
  assert.equal(reviewStateFor([]), null);
});
