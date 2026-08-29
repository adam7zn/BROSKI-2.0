import { writeFileSync } from 'node:fs';

import type { StudentProfile } from '@math-study-companion/contracts';
import {
  UnsupportedFileError,
  type AttachmentDownloader,
  type DocumentReader,
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
export async function handleUpload(
  input: HandleUploadInput,
): Promise<{ message: string; result: ApplyResult | null }> {
  if (
    input.attachment.sizeBytes !== null &&
    input.attachment.sizeBytes > MAX_UPLOAD_BYTES
  ) {
    return {
      message: 'Den filen är för stor för mig. Ta en bild av sidan istället.',
      result: null,
    };
  }

  let file;
  try {
    file = await input.downloader.downloadAttachment(input.attachment);
  } catch {
    return {
      message: 'Jag kom inte åt filen. Kan du skicka den igen?',
      result: null,
    };
  }

  let reading;
  try {
    reading = await input.reader.read(file);
  } catch (error) {
    if (error instanceof UnsupportedFileError) {
      return { message: error.message, result: null };
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
  if (
    (reading.kind === 'material' || reading.kind === 'assignment') &&
    reading.extractedText?.trim()
  ) {
    input.store.saveBookPage({
      id: `upload:${input.attachment.providerFileId}`,
      label: reading.summary.trim().slice(0, 40) || 'Uppladdad sida',
      text: reading.extractedText.trim(),
      sourceKind: 'uploaded',
    });
  }

  if (result.nextAssessment) {
    input.store.saveProfile(input.conversationId, {
      ...input.profile,
      nextAssessment: result.nextAssessment,
      updatedAt: new Date().toISOString(),
    });
  }

  return { message: result.message, result };
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
