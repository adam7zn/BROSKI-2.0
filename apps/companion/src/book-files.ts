import { readdirSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

/**
 * Finding and naming the pages of a scanned book.
 *
 * The label is what the companion cites back — "s. 42" — so it has to be the
 * page the student would turn to, not the file's position in a folder.
 */

export const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

export function isReadable(fileName: string): boolean {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] !== undefined;
}

/** Every readable file in the folder and below it, in page order. */
export function findPages(root: string): string[] {
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (isReadable(entry.name)) found.push(path);
    }
  };
  walk(root);

  // By page number, so page-9 comes before page-10 and the chapter reads in
  // order however the scans were split across folders.
  return found.sort((a, b) => {
    const byPage =
      (pageNumber(a) ?? Number.MAX_SAFE_INTEGER) -
      (pageNumber(b) ?? Number.MAX_SAFE_INTEGER);
    return byPage !== 0 ? byPage : a.localeCompare(b, 'sv', { numeric: true });
  });
}

/** Stable across runs, so re-indexing updates a page instead of duplicating it. */
export function idFor(root: string, file: string): string {
  return relative(root, file).replaceAll('\\', '/');
}

/** "page-006.JPG" is cited as "s. 6"; a contents page says what it is. */
export function labelFor(file: string): string {
  const stem = basename(file, extname(file));
  if (/contents|innehåll/i.test(stem)) {
    const index = /(\d+)/.exec(stem);
    return index ? `Innehåll ${Number(index[1])}` : 'Innehåll';
  }
  const page = pageNumber(file);
  return page === null ? stem : `s. ${page}`;
}

/**
 * The page number in a file name.
 *
 * The bare "s" form needs a word boundary: without it "contents-01" reads as
 * page 1, and the companion would cite the table of contents as a page of
 * mathematics.
 */
export function pageNumber(file: string): number | null {
  const stem = basename(file, extname(file));
  if (/contents|innehåll/i.test(stem)) return null;
  const match = /(?:page|sida|sid)[-_ ]?(\d{1,4})|\bs[-_. ]?(\d{1,4})/i.exec(
    stem,
  );
  if (!match) return null;
  const digits = match[1] ?? match[2];
  return digits === undefined ? null : Number(digits);
}
