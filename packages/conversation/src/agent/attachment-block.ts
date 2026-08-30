import type Anthropic from '@anthropic-ai/sdk';

import type { DownloadedAttachment } from '../messaging/port.js';

/** The file types the model can actually look at. */
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export class UnsupportedFileError extends Error {
  constructor(readonly mimeType: string) {
    super(
      `I can read photos and PDFs. This was ${mimeType}, which I cannot open.`,
    );
    this.name = 'UnsupportedFileError';
  }
}

/** Whether the model can be shown this file at all. */
export function isReadableByModel(mimeType: string): boolean {
  return IMAGE_TYPES.has(mimeType) || mimeType === 'application/pdf';
}

/**
 * Turns a file the student sent into something the model can look at.
 *
 * Shared by the document reader and the tutor on purpose: the picture a
 * student photographed has to reach both, and one of them converting it
 * differently from the other is how "I see no image" bugs happen.
 */
export function toModelContentBlock(
  file: DownloadedAttachment,
): Anthropic.ContentBlockParam {
  const data = Buffer.from(file.bytes).toString('base64');

  if (IMAGE_TYPES.has(file.mimeType)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimeType as
          'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data,
      },
    };
  }

  if (file.mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }

  throw new UnsupportedFileError(file.mimeType);
}
