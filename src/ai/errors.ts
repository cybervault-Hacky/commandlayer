/**
 * Phase 3 — typed AI error helpers.
 *
 * The single source of truth for AI error → user-safe wording. Provider
 * exceptions, HTTP details, and stack traces must be translated through
 * here; nothing else may reach the UI.
 */
import { USER_ERROR_MESSAGES } from '@/shared/constants/errors';
import { AIErrorCode, type AIError } from './types';

const RETRYABLE: ReadonlySet<AIErrorCode> = new Set<AIErrorCode>([
  AIErrorCode.AI_TIMEOUT,
  AIErrorCode.AI_RATE_LIMITED,
  AIErrorCode.AI_NETWORK_ERROR,
  AIErrorCode.AI_PAGE_UNAVAILABLE,
]);

/** Build a typed AIError with the canonical user-safe message. */
export function aiError(code: AIErrorCode, message?: string): AIError {
  return {
    code,
    message: message ?? USER_ERROR_MESSAGES[code],
    retryable: RETRYABLE.has(code),
  };
}

/**
 * Convert an arbitrary thrown value into a typed AIError. Never leaks
 * details: unknown errors become a generic provider error.
 */
export function toAIError(value: unknown): AIError {
  if (isKnownAIError(value)) return value;
  if (value instanceof Error && value.name === 'AbortError') {
    return aiError(AIErrorCode.AI_CANCELLED);
  }
  return aiError(AIErrorCode.AI_PROVIDER_ERROR);
}

function isKnownAIError(value: unknown): value is AIError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    Object.values(AIErrorCode).includes(v.code as AIErrorCode) &&
    typeof v.retryable === 'boolean' &&
    typeof v.message === 'string'
  );
}
