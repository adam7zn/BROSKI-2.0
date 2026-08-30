import { writeFileSync } from 'node:fs';

import type { StudentProfile } from '@math-study-companion/contracts';
import {
  UnsupportedFileError,
  type AttachmentDownloader,
  type DocumentKind,
  type DocumentReader,
  type DownloadedAttachment,
  type InboundAttachment,
} from '@math-study-companion/conversation';

import {
  loadCoursePlan,
  loadStudyPlan,
  type CoursePlan,
  type StudyItem,
} from '@math-study-companion/planning';

import { applyDocument, type ApplyResult } from './apply-document.js';
import type { Config } from './config.js';
import type { BookPage } from './local-store.js';
import { writeCoursePlan } from './course-plan-from-profile.js';
import type { InteractionStore } from './local-store.js';

/** Telegram will not hand over anything larger, and neither should we accept it. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface HandleUploadInput {
  attachment: InboundAttachment;
  downloader: AttachmentDownloader;
  reader: DocumentReader;
  profile: StudentProfile;
  config: Config;
  store: InteractionStore;
  conversationId: string;
  today?: Date;
}

/**
 * Reads one photo or file the student sent, and writes what it learned into the
 * course calendar and the study plan.
 *
 * The reply it returns is what the student sees: what was understood, how many
 * lessons were placed, and an honest note when the photo was hard to read.
 */
export interface UploadOutcome {
  message: string;
  result: ApplyResult | null;
  /** Pages this upload added, so the next answer can be grounded in them. */
  savedPages: BookPage[];
  /**
   * The file itself, when it was read.
   *
   * The extracted text is what makes a page searchable; the picture is what
   * the student is actually pointing at when they ask "hur löser jag den
   * första?", so the tutor has to be able to look at it too.
   */
  file: DownloadedAttachment | null;
  /** What the upload turned out to be, when it could be read at all. */
  kind: DocumentKind | null;
}

export async function handleUpload(
  input: HandleUploadInput,
): Promise<UploadOutcome> {
  if (
    input.attachment.sizeBytes !== null &&
    input.attachment.sizeBytes > MAX_UPLOAD_BYTES
  ) {
    return {
      message: 'Den filen är för stor för mig. Ta en bild av sidan istället.',
      result: null,
      savedPages: [],
      file: null,
      kind: null,
    };
  }

  let file;
  try {
    file = await input.downloader.downloadAttachment(input.attachment);
  } catch {
    return {
      message: 'Jag kom inte åt filen. Kan du skicka den igen?',
      result: null,
      savedPages: [],
      file: null,
      kind: null,
    };
  }

  let reading;
  try {
    reading = await input.reader.read(file);
  } catch (error) {
    if (error instanceof UnsupportedFileError) {
      return {
        message: error.message,
        result: null,
        savedPages: [],
        file: null,
        kind: null,
      };
    }
    throw error;
  }

  const coursePlan = loadCoursePlanOrEmpty(input.config, input.profile);
  const studyItems = loadStudyItemsOrEmpty(input.config);

  const result = applyDocument(reading, {
    profile: input.profile,
    coursePlan,
    studyItems,
    ...(input.today ? { today: input.today } : {}),
  });

  if (result.coursePlan) {
    writeCoursePlan(input.config.coursePlanPath, result.coursePlan);
  }
  if (result.studyItems.length > 0) {
    writeStudyPlan(input.config.studyPlanPath, result.studyItems);
  }
  // A page of the book is worth keeping as a page of the book, not only as
  // something to practise on: the next question may be about it.
  const savedPages: BookPage[] = [];
  if (
    (reading.kind === 'material' || reading.kind === 'assignment') &&
    reading.extractedText?.trim()
  ) {
    const page: BookPage = {
      id: `upload:${input.attachment.providerFileId}`,
      label: reading.summary.trim().slice(0, 40) || 'Uppladdad sida',
      text: reading.extractedText.trim(),
    };
    input.store.saveBookPage({ ...page, sourceKind: 'uploaded' });
    savedPages.push(page);
  }

  if (result.nextAssessment) {
    input.store.saveProfile(input.conversationId, {
      ...input.profile,
      nextAssessment: result.nextAssessment,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    message: result.message,
    result,
    savedPages,
    file,
    kind: reading.kind,
  };
}

export function writeStudyPlan(path: string, items: StudyItem[]): void {
  writeFileSync(path, `${JSON.stringify(items, null, 2)}\n`);
}

function loadCoursePlanOrEmpty(
  config: Config,
  profile: StudentProfile,
): CoursePlan {
  try {
    return loadCoursePlan(config.coursePlanPath);
  } catch {
    return {
      courseName: profile.course?.code ?? 'Matematik',
      timezone: profile.timezone,
      lessons: [],
    };
  }
}

function loadStudyItemsOrEmpty(config: Config): StudyItem[] {
  try {
    return loadStudyPlan(config.studyPlanPath);
  } catch {
    return [];
  }
}
