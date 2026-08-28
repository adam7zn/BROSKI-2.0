export abstract class InteractionRepositoryError extends Error {
  abstract readonly code:
    | 'INTERACTION_NOT_FOUND'
    | 'DUPLICATE_INTERACTION'
    | 'DUPLICATE_RESULT'
    | 'INTERACTION_ID_MISMATCH';
}

export class InteractionNotFoundError extends InteractionRepositoryError {
  readonly code = 'INTERACTION_NOT_FOUND' as const;

  constructor(readonly interactionId: string) {
    super(`Interaction '${interactionId}' was not found.`);
    this.name = 'InteractionNotFoundError';
  }
}

export class DuplicateInteractionError extends InteractionRepositoryError {
  readonly code = 'DUPLICATE_INTERACTION' as const;

  constructor(
    readonly interactionId: string,
    options?: ErrorOptions,
  ) {
    super(`Interaction '${interactionId}' already exists.`, options);
    this.name = 'DuplicateInteractionError';
  }
}

export class InteractionAlreadyCompletedError extends InteractionRepositoryError {
  readonly code = 'DUPLICATE_RESULT' as const;

  constructor(readonly interactionId: string) {
    super(`Interaction '${interactionId}' already has a result.`);
    this.name = 'InteractionAlreadyCompletedError';
  }
}

export class InteractionIdMismatchError extends InteractionRepositoryError {
  readonly code = 'INTERACTION_ID_MISMATCH' as const;

  constructor(
    readonly expectedInteractionId: string,
    readonly receivedInteractionId: string,
  ) {
    super(
      `Interaction ID mismatch: expected '${expectedInteractionId}', received '${receivedInteractionId}'.`,
    );
    this.name = 'InteractionIdMismatchError';
  }
}
