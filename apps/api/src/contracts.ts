import {
  backendToConversationSchema,
  conversationToBackendSchema,
} from '@math-study-companion/contracts';

import type { BackendContext, ConversationResult } from './domain.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  { success: true; data: T } | { success: false; issues: ValidationIssue[] };

export interface RuntimeSchema<T> {
  readonly _output?: T;
  safeParse(value: unknown): unknown;
}

export interface DemoContracts {
  backendContext: RuntimeSchema<BackendContext>;
  conversationResult: RuntimeSchema<ConversationResult>;
  source: 'packages/contracts';
}

export function loadDemoContracts(): DemoContracts {
  return {
    backendContext: backendToConversationSchema,
    conversationResult: conversationToBackendSchema,
    source: 'packages/contracts',
  };
}

export function validateWithSchema<T>(
  schema: RuntimeSchema<T>,
  value: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(value);

  if (!isRecord(parsed) || typeof parsed.success !== 'boolean') {
    return {
      success: false,
      issues: [
        { path: '$', message: 'Contract validator returned an invalid result' },
      ],
    };
  }

  if (parsed.success === true && 'data' in parsed) {
    return { success: true, data: parsed.data as T };
  }

  return { success: false, issues: extractIssues(parsed) };
}

function extractIssues(parsed: Record<string, unknown>): ValidationIssue[] {
  const error = isRecord(parsed.error) ? parsed.error : undefined;
  const rawIssues = error && Array.isArray(error.issues) ? error.issues : [];
  const issues = rawIssues.flatMap((issue): ValidationIssue[] => {
    if (!isRecord(issue)) return [];
    const rawPath = Array.isArray(issue.path)
      ? issue.path.join('.')
      : issue.path;
    return [
      {
        path: typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : '$',
        message:
          typeof issue.message === 'string' ? issue.message : 'Invalid value',
      },
    ];
  });

  return issues.length > 0
    ? issues
    : [{ path: '$', message: 'Payload failed validation' }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
