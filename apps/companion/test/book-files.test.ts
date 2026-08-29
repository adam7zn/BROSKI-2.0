import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { findPages, idFor, labelFor, pageNumber } from '../src/book-files.js';

const workspace = mkdtempSync(join(tmpdir(), 'msc-book-'));
after(() => rmSync(workspace, { recursive: true, force: true }));

// The layout the scans actually arrived in: one chapter, split across folders
// of ten pages each.
const root = join(workspace, 'chapter-1');
for (const [folder, files] of [
  [
    'page-1-10-chapter-1',
    ['contents-01.JPG', 'contents-02.JPG', 'page-006.JPG', 'page-009.JPG'],
  ],
  ['page-11-20-chapter-1', ['page-010.JPG', 'page-014.JPG']],
  ['page-51-60-chapter-1', ['page-063.JPG']],
] as const) {
  mkdirSync(join(root, folder), { recursive: true });
  for (const file of files) writeFileSync(join(root, folder, file), 'x');
}
writeFileSync(join(root, 'anteckningar.txt'), 'not a page');

test('pages are found through the folders the scans were split into', () => {
  const found = findPages(root).map((file) => file.split('/').at(-1));
  assert.equal(found.length, 7);
  // A text file among the scans is not a page.
  assert.ok(!found.includes('anteckningar.txt'));
});

test('pages are ordered by page number, not by folder or by string', () => {
  const numbered = findPages(root)
    .map((file) => pageNumber(file))
    .filter((page): page is number => page !== null);
  assert.deepEqual(numbered, [6, 9, 10, 14, 63]);
});

test('a page is cited by the number the student would turn to', () => {
  assert.equal(labelFor('chapter-1/page-1-10/page-006.JPG'), 's. 6');
  assert.equal(labelFor('chapter-1/page-51-60/page-063.JPG'), 's. 63');
});

test('a contents page is never cited as a page of mathematics', () => {
  // "contents-01" ends in "s-01", which a loose reader takes for page 1.
  assert.equal(pageNumber('contents-01.JPG'), null);
  assert.equal(labelFor('contents-01.JPG'), 'Innehåll 1');
});

test('the id survives re-indexing, so a page updates instead of duplicating', () => {
  const file = join(root, 'page-11-20-chapter-1', 'page-014.JPG');
  assert.equal(idFor(root, file), 'page-11-20-chapter-1/page-014.JPG');
});

test('an unnumbered scan keeps its own name rather than inventing a page', () => {
  assert.equal(pageNumber('framsida.JPG'), null);
  assert.equal(labelFor('framsida.JPG'), 'framsida');
});
