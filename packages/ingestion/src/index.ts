import { createHash } from 'node:crypto';

import type {
  ExtractedSourceBlock,
  SourceBlockType,
  SourceBoundingBox,
  SourceCandidate,
} from '@math-study-companion/contracts';

export interface RawVisionBlock {
  kind: 'paragraph' | 'title' | 'table' | 'list';
  transcript: string;
  boundingBox: SourceBoundingBox;
  confidence: number;
}

export interface RawVisionPass {
  name: 'original' | 'contrast';
  blocks: RawVisionBlock[];
}

export interface RawVisionPage {
  filePageNumber: number;
  printedPageNumber: string | null;
  imagePath: string;
  width: number;
  height: number;
  perspectiveCorrected: boolean;
  passes: RawVisionPass[];
}

const mathPattern =
  /[=≈≠≤≥±√∫∑∞^_]|\b(?:lim|sin|cos|tan|log)\b|\d\s*[+−*/]\s*\d/iu;
const exercisePattern = /^(?:\d+[.:]\d+|övning|uppgift|nivå)\b/iu;

export const classifyBlock = (block: RawVisionBlock): SourceBlockType => {
  const text = block.transcript.trim();
  if (block.kind === 'title') return 'heading';
  if (block.kind === 'table') return 'table';
  if (/^innehåll\b/iu.test(text)) return 'contents';
  if (/^exempel\b/iu.test(text)) return 'example';
  if (/^lösning\b/iu.test(text)) return 'solution';
  if (exercisePattern.test(text)) return 'exercise';
  if (/\b(?:graf|koordinatsystem|x-axel|y-axel)\b/iu.test(text)) return 'graph';
  if (
    block.boundingBox[1] > 0.94 ||
    (/^\d{1,3}$/.test(text) && block.boundingBox[1] > 0.88)
  ) {
    return 'footer';
  }
  if (
    mathPattern.test(text) &&
    (text.length < 140 || text.split('\n').length <= 3)
  ) {
    return 'formula';
  }
  if (text.length < 80 && block.boundingBox[3] < 0.07) return 'heading';
  return 'prose';
};

export const intersectionOverUnion = (
  a: SourceBoundingBox,
  b: SourceBoundingBox,
): number => {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a[2] * a[3] + b[2] * b[3] - intersection;
  return union === 0 ? 0 : intersection / union;
};

const editDistance = (left: string, right: string): number => {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
};

const normalized = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('sv-SE');

export const candidateAgreement = (left: string, right: string): number => {
  const a = normalized(left);
  const b = normalized(right);
  const length = Math.max(a.length, b.length);
  return length === 0 ? 1 : Math.max(0, 1 - editDistance(a, b) / length);
};

export const validateLatex = (latex: string): string[] => {
  const flags: string[] = [];
  const pairs: Array<[string, string]> = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];
  for (const [opening, closing] of pairs) {
    let depth = 0;
    for (const character of latex) {
      if (
        character === opening &&
        (opening !== '{' || !latex.includes(`\\${opening}`))
      )
        depth += 1;
      if (
        character === closing &&
        (closing !== '}' || !latex.includes(`\\${closing}`))
      )
        depth -= 1;
      if (depth < 0) break;
    }
    if (depth !== 0) flags.push('unbalanced_brackets');
  }
  if (/\ufffd|�/u.test(latex)) flags.push('suspicious_character');
  if (/\\(?:frac|sqrt)\b(?!\s*\{)/u.test(latex))
    flags.push('malformed_latex_command');
  return [...new Set(flags)];
};

const isSpecialized = (block: RawVisionBlock): boolean =>
  block.kind === 'table' || block.kind === 'list' || block.kind === 'title';

export const removeLayoutDuplicates = (
  blocks: RawVisionBlock[],
): RawVisionBlock[] =>
  blocks.filter(
    (block, index) =>
      !blocks.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          isSpecialized(other) &&
          !isSpecialized(block) &&
          intersectionOverUnion(block.boundingBox, other.boundingBox) > 0.42,
      ),
  );

export const groupTextBlocks = (blocks: RawVisionBlock[]): RawVisionBlock[] => {
  const ordered = orderBlocks(blocks);
  const grouped: RawVisionBlock[] = [];
  for (const block of ordered) {
    const previous = grouped.at(-1);
    if (
      previous === undefined ||
      previous.kind !== 'paragraph' ||
      block.kind !== 'paragraph'
    ) {
      grouped.push(block);
      continue;
    }
    const previousBox = previous.boundingBox;
    const currentBox = block.boundingBox;
    const gap = currentBox[1] - (previousBox[1] + previousBox[3]);
    const previousColumn = previousBox[0] + previousBox[2] / 2 < 0.5 ? 0 : 1;
    const currentColumn = currentBox[0] + currentBox[2] / 2 < 0.5 ? 0 : 1;
    const overlap = Math.max(
      0,
      Math.min(previousBox[0] + previousBox[2], currentBox[0] + currentBox[2]) -
        Math.max(previousBox[0], currentBox[0]),
    );
    const overlapRatio = overlap / Math.min(previousBox[2], currentBox[2]);
    const aligned =
      Math.abs(previousBox[0] - currentBox[0]) < 0.08 || overlapRatio > 0.3;
    if (
      gap < -0.004 ||
      gap > 0.018 ||
      previousColumn !== currentColumn ||
      !aligned
    ) {
      grouped.push(block);
      continue;
    }
    const left = Math.min(previousBox[0], currentBox[0]);
    const top = Math.min(previousBox[1], currentBox[1]);
    const right = Math.max(
      previousBox[0] + previousBox[2],
      currentBox[0] + currentBox[2],
    );
    const bottom = Math.max(
      previousBox[1] + previousBox[3],
      currentBox[1] + currentBox[3],
    );
    grouped[grouped.length - 1] = {
      kind: 'paragraph',
      transcript: `${previous.transcript}\n${block.transcript}`,
      boundingBox: [left, top, right - left, bottom - top] as SourceBoundingBox,
      confidence: Math.min(previous.confidence, block.confidence),
    };
  }
  return grouped;
};

export const orderBlocks = (blocks: RawVisionBlock[]): RawVisionBlock[] => {
  const fullWidth = blocks.filter((block) => block.boundingBox[2] >= 0.68);
  const narrow = blocks.filter((block) => block.boundingBox[2] < 0.68);
  const sectionFor = (block: RawVisionBlock): number =>
    fullWidth.filter(
      (separator) => separator.boundingBox[1] < block.boundingBox[1],
    ).length;
  return [...blocks].sort((a, b) => {
    const section = sectionFor(a) - sectionFor(b);
    if (section !== 0) return section;
    if (narrow.includes(a) && narrow.includes(b)) {
      const aColumn = a.boundingBox[0] + a.boundingBox[2] / 2 < 0.5 ? 0 : 1;
      const bColumn = b.boundingBox[0] + b.boundingBox[2] / 2 < 0.5 ? 0 : 1;
      if (aColumn !== bColumn) return aColumn - bColumn;
    }
    return (
      a.boundingBox[1] - b.boundingBox[1] || a.boundingBox[0] - b.boundingBox[0]
    );
  });
};

const sourceKey = (page: number, block: RawVisionBlock): string =>
  createHash('sha1')
    .update(
      `${page}:${block.kind}:${block.boundingBox.join(',')}:${normalized(block.transcript)}`,
    )
    .digest('hex');

export const structurePage = (page: RawVisionPage): ExtractedSourceBlock[] => {
  const originalPass = page.passes.find((pass) => pass.name === 'original');
  const contrastPass = page.passes.find((pass) => pass.name === 'contrast');
  if (originalPass === undefined)
    throw new Error(`Page ${page.filePageNumber} has no original pass.`);
  const originals = groupTextBlocks(
    removeLayoutDuplicates(originalPass.blocks),
  );
  const contrasts = groupTextBlocks(
    removeLayoutDuplicates(contrastPass?.blocks ?? []),
  );
  const unusedContrast = new Set(contrasts.map((_, index) => index));

  return originals.map((block, index) => {
    let bestIndex: number | undefined;
    let bestOverlap = 0;
    for (const contrastIndex of unusedContrast) {
      const overlap = intersectionOverUnion(
        block.boundingBox,
        contrasts[contrastIndex]!.boundingBox,
      );
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = contrastIndex;
      }
    }
    const match =
      bestIndex !== undefined && bestOverlap >= 0.2
        ? contrasts[bestIndex]
        : undefined;
    if (bestIndex !== undefined && match !== undefined)
      unusedContrast.delete(bestIndex);
    const candidates: SourceCandidate[] = [
      {
        engine: 'apple_vision',
        passName: 'original',
        contentMarkdown: block.transcript,
        latex: null,
        confidence: block.confidence,
        metadata: {
          kind: block.kind,
          perspectiveCorrected: page.perspectiveCorrected,
        },
      },
    ];
    if (match !== undefined)
      candidates.push({
        engine: 'apple_vision',
        passName: 'contrast',
        contentMarkdown: match.transcript,
        latex: null,
        confidence: match.confidence,
        metadata: { kind: match.kind, overlap: bestOverlap },
      });
    const type = classifyBlock(block);
    const agreement =
      match === undefined
        ? 0
        : candidateAgreement(block.transcript, match.transcript);
    const reviewReasons: string[] = [];
    if (block.confidence < 0.8) reviewReasons.push('low_confidence');
    if (match === undefined) reviewReasons.push('missing_second_pass');
    else if (agreement < 0.92) reviewReasons.push('ocr_disagreement');
    if (/\ufffd|�|[|]{3,}/u.test(block.transcript))
      reviewReasons.push('suspicious_character');
    if (type === 'formula') reviewReasons.push('math_requires_review');
    if (type === 'graph' || type === 'image')
      reviewReasons.push('visual_block_requires_review');
    return {
      sourceKey: sourceKey(page.filePageNumber, block),
      sequenceNumber: index + 1,
      blockType: type,
      boundingBox: block.boundingBox,
      confidence:
        match === undefined
          ? block.confidence
          : Math.min(block.confidence, match.confidence),
      reviewReasons: [...new Set(reviewReasons)],
      candidates,
    };
  });
};
