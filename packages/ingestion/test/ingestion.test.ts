import { describe, expect, it } from 'vitest';

import {
  candidateAgreement,
  classifyBlock,
  groupTextBlocks,
  intersectionOverUnion,
  orderBlocks,
  structurePage,
  validateLatex,
  type RawVisionBlock,
} from '../src/index.js';

const block = (
  transcript: string,
  boundingBox: [number, number, number, number],
  kind: RawVisionBlock['kind'] = 'paragraph',
): RawVisionBlock => ({ kind, transcript, boundingBox, confidence: 0.95 });

describe('structured local ingestion', () => {
  it('converts layout into left-column then right-column reading order', () => {
    const ordered = orderBlocks([
      block('right first', [.55, .1, .35, .1]),
      block('left second', [.08, .4, .35, .1]),
      block('left first', [.08, .1, .35, .1]),
      block('right second', [.55, .4, .35, .1]),
    ]);
    expect(ordered.map((item) => item.transcript)).toEqual([
      'left first', 'left second', 'right first', 'right second',
    ]);
  });

  it('classifies Swedish textbook structures and mathematical notation', () => {
    expect(classifyBlock(block('Exempel 4', [.1, .2, .3, .05]))).toBe('example');
    expect(classifyBlock(block('Lösning', [.1, .3, .3, .05]))).toBe('solution');
    expect(classifyBlock(block('2x + 4 = 12', [.1, .4, .3, .05]))).toBe('formula');
    expect(classifyBlock(block('| x | y |', [.1, .5, .6, .2], 'table'))).toBe('table');
  });

  it('groups adjacent paragraph lines without crossing columns', () => {
    const grouped = groupTextBlocks([
      block('Rad ett', [.08, .1, .35, .02]),
      block('Rad två', [.08, .13, .35, .02]),
      block('Höger kolumn', [.56, .1, .34, .02]),
    ]);
    expect(grouped.map((item) => item.transcript)).toEqual([
      'Rad ett\nRad två',
      'Höger kolumn',
    ]);
  });

  it('matches extraction candidates by geometry and flags disagreement', () => {
    const blocks = structurePage({
      filePageNumber: 9, printedPageNumber: '9', imagePath: '/tmp/page.jpg',
      width: 1000, height: 1500, perspectiveCorrected: true,
      passes: [
        { name: 'original', blocks: [block('Kvadreringsregeln', [.1, .1, .6, .08])] },
        { name: 'contrast', blocks: [block('Kvadreringsregelrn', [.1, .1, .6, .08])] },
      ],
    });
    expect(blocks[0]?.candidates).toHaveLength(2);
    expect(blocks[0]?.reviewReasons).toContain('ocr_disagreement');
    expect(intersectionOverUnion([.1, .1, .4, .2], [.1, .1, .4, .2])).toBe(1);
    expect(candidateAgreement('ÅÄÖ', 'åäö')).toBe(1);
  });

  it('detects malformed formula structures', () => {
    expect(validateLatex('\\frac{x{2}')).toContain('unbalanced_brackets');
    expect(validateLatex('\\sqrt x')).toContain('malformed_latex_command');
    expect(validateLatex('x + �')).toContain('suspicious_character');
  });
});
