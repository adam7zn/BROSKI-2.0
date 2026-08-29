import {
  documentReadingSchema,
  type DocumentReader,
  type DocumentReading,
} from './document-reader.js';

/**
 * A stand-in for the vision reader, so the upload path can be run and tested
 * without an API key or a network (`docs/RULES.md` §6.3).
 *
 * It reads nothing at all: it returns whatever reading it was given. Never
 * point a real upload at it and expect the contents to matter.
 */
export class ScriptedDocumentReader implements DocumentReader {
  readonly #readings: DocumentReading[];

  constructor(readings: DocumentReading[] | DocumentReading) {
    const list = Array.isArray(readings) ? readings : [readings];
    this.#readings = list.map((reading) =>
      documentReadingSchema.parse(reading),
    );
  }

  async read(): Promise<DocumentReading> {
    return this.#readings.shift() ?? this.#unreadable();
  }

  #unreadable(): DocumentReading {
    return {
      kind: 'unreadable',
      summary: 'scripted reader ran out of readings',
      courseName: null,
      rows: [],
      extractedText: null,
      confidence: 0,
    };
  }
}
