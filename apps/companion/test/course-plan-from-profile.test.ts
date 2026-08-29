import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StudentProfile } from '@math-study-companion/contracts';

import { coursePlanFromProfile } from '../src/course-plan-from-profile.js';

const profile: StudentProfile = {
  displayName: 'William',
  schoolYear: 2,
  age: 17,
  className: 'NA22B',
  course: { code: 'Ma2c', raw: 'Ma2c' },
  textbook: 'Matematik 5000+ 2c',
  currentTopic: 'andragradsekvationer',
  selfAssessedLevel: 'struggling',
  previousGrade: 'C',
  lessonSlots: [
    { weekday: 'tuesday', startsAt: '09:15' },
    { weekday: 'thursday', startsAt: '13:00' },
  ],
  nextAssessment: null,
  quietHours: { start: '21:00', end: '07:00' },
  timezone: 'Europe/Stockholm',
  language: 'sv',
  updatedAt: new Date().toISOString(),
};

test('weekly slots become dated lessons for the coming weeks', () => {
  // A Monday, so the first Tuesday is the next day.
  const plan = coursePlanFromProfile(profile, {
    from: new Date(2026, 8, 7),
    weeks: 2,
  });

  assert.equal(plan.courseName, 'Ma2c');
  assert.equal(plan.timezone, 'Europe/Stockholm');
  assert.equal(plan.lessons.length, 4);
  assert.deepEqual(
    plan.lessons.map((lesson) => lesson.startsAt),
    [
      '2026-09-08 09:15',
      '2026-09-10 13:00',
      '2026-09-15 09:15',
      '2026-09-17 13:00',
    ],
  );
});

test('the mapping from lesson to study item is left for a person to fill in', () => {
  const plan = coursePlanFromProfile(profile, { from: new Date(2026, 8, 7) });
  for (const lesson of plan.lessons) {
    assert.deepEqual(lesson.covers, []);
    assert.deepEqual(lesson.prepares, []);
  }
});

test('no lesson times means no invented calendar', () => {
  const plan = coursePlanFromProfile(
    { ...profile, lessonSlots: [] },
    { from: new Date(2026, 8, 7) },
  );
  assert.deepEqual(plan.lessons, []);
});
