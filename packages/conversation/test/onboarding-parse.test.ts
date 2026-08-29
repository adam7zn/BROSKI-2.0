import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isSkip,
  parseAge,
  parseCourse,
  parseDate,
  parseLessonSlots,
  parseLevel,
  parseName,
  parseQuietHours,
  parseSchoolYear,
  parseTime,
} from '../src/onboarding/parse.js';

test('a name survives the padding people put around it', () => {
  assert.equal(parseName('William'), 'William');
  assert.equal(parseName('jag heter William'), 'William');
  assert.equal(parseName('  Kalla mig Willy.  '), 'Willy');
  // A sentence is not a name.
  assert.equal(parseName('jag vet inte riktigt vad du menar med det'), null);
  assert.equal(parseName('   '), null);
});

test('the school year is read from words or digits', () => {
  assert.equal(parseSchoolYear('tvåan'), 2);
  assert.equal(parseSchoolYear('åk 3'), 3);
  assert.equal(parseSchoolYear('går i ettan'), 1);
  assert.equal(parseSchoolYear('gymnasiet'), null);
});

test('an age outside upper secondary is not an age', () => {
  assert.equal(parseAge('17'), 17);
  assert.equal(parseAge('jag är 16 år'), 16);
  assert.equal(parseAge('5'), null);
  assert.equal(parseAge('42'), null);
});

test('Swedish maths courses are recognised however they are written', () => {
  for (const written of ['Ma2c', 'matte 2c', 'matematik 2 c', '2c', 'MA2C']) {
    assert.equal(parseCourse(written)?.code, 'Ma2c', written);
  }
  assert.equal(parseCourse('matte 4')?.code, 'Ma4');
  assert.equal(parseCourse('ma5')?.code, 'Ma5');
});

test('an unknown course keeps what the student said instead of guessing', () => {
  const course = parseCourse('nåt slags matte tror jag');
  assert.equal(course?.code, null);
  assert.equal(course?.raw, 'nåt slags matte tror jag');
});

test('a course with no track letter does not invent one', () => {
  // "Ma2" alone is not a course code; the raw text is kept instead.
  assert.equal(parseCourse('ma2')?.code, null);
  assert.equal(parseCourse('ma2')?.raw, 'ma2');
});

test('self-assessment reads the words a student actually uses', () => {
  assert.equal(parseLevel('det känns svårt'), 'struggling');
  assert.equal(parseLevel('kämpar lite'), 'struggling');
  assert.equal(parseLevel('okej'), 'okay');
  assert.equal(parseLevel('går bra faktiskt'), 'confident');
  assert.equal(parseLevel('mmm'), null);
});

test('a weekly schedule is read out of one sentence', () => {
  assert.deepEqual(parseLessonSlots('tis 9.15 och tors 13'), [
    { weekday: 'tuesday', startsAt: '09:15' },
    { weekday: 'thursday', startsAt: '13:00' },
  ]);
  assert.deepEqual(parseLessonSlots('måndagar 08:00, onsdagar 10.15'), [
    { weekday: 'monday', startsAt: '08:00' },
    { weekday: 'wednesday', startsAt: '10:15' },
  ]);
});

test('a weekday with no time is dropped rather than guessed at', () => {
  assert.deepEqual(parseLessonSlots('måndag och fredag 14'), [
    { weekday: 'friday', startsAt: '14:00' },
  ]);
  assert.deepEqual(parseLessonSlots('vet inte riktigt'), []);
});

test('times are read in the forms people type them', () => {
  assert.equal(parseTime('9.15'), '09:15');
  assert.equal(parseTime('kl 8'), '08:00');
  assert.equal(parseTime('13:45'), '13:45');
  assert.equal(parseTime('25:00'), null);
});

test('quiet hours accept a range or an "after"', () => {
  assert.deepEqual(parseQuietHours('21-07'), { start: '21:00', end: '07:00' });
  assert.deepEqual(parseQuietHours('22 till 06'), {
    start: '22:00',
    end: '06:00',
  });
  assert.deepEqual(parseQuietHours('efter 22'), {
    start: '22:00',
    end: '07:00',
  });
  assert.equal(parseQuietHours('när som helst'), null);
});

test('dates are read as Swedish students write them', () => {
  const today = new Date('2026-09-01T00:00:00Z');
  assert.equal(parseDate('3 oktober', today), '2026-10-03');
  assert.equal(parseDate('3/10', today), '2026-10-03');
  assert.equal(parseDate('2026-10-03', today), '2026-10-03');
  // A date already past this year means the next one.
  assert.equal(parseDate('3 mars', today), '2027-03-03');
});

test('skipping is recognised in both languages', () => {
  for (const word of ['skip', 'hoppa över', 'vet inte', '-', '']) {
    assert.equal(isSkip(word), true, word);
  }
  assert.equal(isSkip('Ma2c'), false);
});
