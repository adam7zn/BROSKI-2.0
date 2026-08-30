import {
  verifiedExerciseContextSchema,
  verifiedExerciseSummarySchema,
  type VerifiedExerciseContext,
  type VerifiedExerciseSummary,
} from '@math-study-companion/contracts';
import type { ExerciseCatalogRepository } from '@math-study-companion/database';

export class InMemoryExerciseCatalogRepository implements ExerciseCatalogRepository {
  readonly #exercises = new Map<string, VerifiedExerciseContext>();

  constructor(exercises: VerifiedExerciseContext[] = []) {
    for (const exercise of exercises) {
      const parsed = verifiedExerciseContextSchema.parse(exercise);
      this.#exercises.set(parsed.exerciseId, parsed);
    }
  }

  async listVerified(): Promise<VerifiedExerciseSummary[]> {
    return [...this.#exercises.values()]
      .sort((left, right) =>
        `${left.sectionCode}:${left.exerciseNumber}:${left.partLabel}`.localeCompare(
          `${right.sectionCode}:${right.exerciseNumber}:${right.partLabel}`,
        ),
      )
      .map((exercise) =>
        verifiedExerciseSummarySchema.parse({
          exerciseId: exercise.exerciseId,
          sourceDocumentId: exercise.sourceDocumentId,
          sourcePageId: exercise.sourcePageId,
          sourceBlockId: exercise.sourceBlockId,
          printedPageNumber: exercise.printedPageNumber,
          sectionCode: exercise.sectionCode,
          sectionTitle: exercise.sectionTitle,
          exerciseNumber: exercise.exerciseNumber,
          partLabel: exercise.partLabel,
          topic: exercise.topic,
          difficulty: exercise.difficulty,
          gradingStrategy: exercise.gradingStrategy,
          contentChecksum: exercise.contentChecksum,
          verifiedBy: exercise.verifiedBy,
          verifiedAt: exercise.verifiedAt,
        }),
      );
  }

  async getVerified(
    exerciseId: string,
  ): Promise<VerifiedExerciseContext | null> {
    const exercise = this.#exercises.get(exerciseId);
    return exercise ? structuredClone(exercise) : null;
  }

  async getVerifiedForInteraction(): Promise<VerifiedExerciseContext | null> {
    return null;
  }
}
