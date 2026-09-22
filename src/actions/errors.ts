/**
 * Phase 4 — typed action errors.
 *
 * Every failure path in the Action Engine maps through here, so the UI
 * only ever sees the fixed user-safe vocabulary. Raw DOM errors, stack
 * traces, and page internals never reach the user.
 */
import { USER_ERROR_MESSAGES } from '@/shared/constants/errors';
import { ActionErrorCode, type ActionError } from './types';

/** Build a typed ActionError with the canonical user-safe message. */
export function actionError(
  code: ActionErrorCode,
  message?: string,
): ActionError {
  return {
    code,
    message: message ?? USER_ERROR_MESSAGES[code],
  };
}

/**
 * Normalize arbitrary thrown values inside the engine into a typed
 * error. Unknown failures become ACTION_EXECUTION_FAILED with safe
 * wording — internals are never forwarded.
 */
export function toActionError(value: unknown): ActionError {
  if (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as ActionError).code === 'string' &&
    Object.values(ActionErrorCode).includes(
      (value as ActionError).code as ActionErrorCode,
    )
  ) {
    return value as ActionError;
  }
  return actionError(ActionErrorCode.ACTION_EXECUTION_FAILED);
}
