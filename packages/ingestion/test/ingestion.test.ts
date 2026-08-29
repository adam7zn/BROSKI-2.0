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
      block('right first', [0.55, 0.1, 0.35, 0.1]),
      block('left second', [0.08, 0.4, 0.35, 0.1]),
      block('left first', [0.08, 0.1, 0.35, 0.1]),
      block('right second', [0.55, 0.4, 0.35, 0.1]),
    ]);
    expect(ordered.map((item) => item.transcript)).toEqual([
      'left first',
      'left second',
      'right first',
      'right second',
    ]);
  });

  it('classifies Swedish textbook structures and mathematical notation', () => {
    expect(classifyBlock(block('Exempel 4', [0.1, 0.2, 0.3, 0.05]))).toBe(
      'example',
    );
    expect(classifyBlock(block('Lösning', [0.1, 0.3, 0.3, 0.05]))).toBe(
      'solution',
    );
    expect(classifyBlock(block('2x + 4 = 12', [0.1, 0.4, 0.3, 0.05]))).toBe(
      'formula',
    );
    expect(
      classifyBlock(block('| x | y |', [0.1, 0.5, 0.6, 0.2], 'table')),
    ).toBe('table');
  });

  it('groups adjacent paragraph lines without crossing columns', () => {
    const grouped = groupTextBlocks([
      block('Rad ett', [0.08, 0.1, 0.35, 0.02]),
      block('Rad två', [0.08, 0.13, 0.35, 0.02]),
      block('Höger kolumn', [0.56, 0.1, 0.34, 0.02]),
    ]);
    expect(grouped.map((item) => item.transcript)).toEqual([
      'Rad ett\nRad två',
      'Höger kolumn',
    ]);
  });

  it('matches extraction candidates by geometry and flags disagreement', () => {
    const blocks = structurePage({
      filePageNumber: 9,
      printedPageNumber: '9',
      imagePath: '/tmp/page.jpg',
      width: 1000,
      height: 1500,
      perspectiveCorrected: true,
      passes: [
        {
          name: 'original',
          blocks: [block('Kvadreringsregeln', [0.1, 0.1, 0.6, 0.08])],
        },
        {
          name: 'contrast',
          blocks: [block('Kvadreringsregelrn', [0.1, 0.1, 0.6, 0.08])],
        },
      ],
    });
    expect(blocks[0]?.candidates).toHaveLength(2);
    expect(blocks[0]?.reviewReasons).toContain('ocr_disagreement');
    expect(
      intersectionOverUnion([0.1, 0.1, 0.4, 0.2], [0.1, 0.1, 0.4, 0.2]),
    ).toBe(1);
    expect(candidateAgreement('ÅÄÖ', 'åäö')).toBe(1);
  });

  it('detects malformed formula structures', () => {
    expect(validateLatex('\\frac{x{2}')).toContain('unbalanced_brackets');
    expect(validateLatex('\\sqrt x')).toContain('malformed_latex_command');
    expect(validateLatex('x + �')).toContain('suspicious_character');
  });
});
