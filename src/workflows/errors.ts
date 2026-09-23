/**
 * Phase 5 — typed workflow errors.
 *
 * Every failure path in the workflow engine maps through here, so the UI
 * only ever sees the fixed, user-safe vocabulary defined in
 * `USER_ERROR_MESSAGES`. Raw failures — DOM internals, stack traces,
 * page wording, provider output — never reach the user.
 */
import { ErrorCode, USER_ERROR_MESSAGES } from '@/shared/constants/errors';

/** The closed set of workflow error codes (a subset of the shared codes). */
export const WORKFLOW_ERROR_CODES = [
  ErrorCode.WORKFLOW_INVALID,
  ErrorCode.WORKFLOW_UNKNOWN,
  ErrorCode.WORKFLOW_TASK_NOT_SUPPORTED,
  ErrorCode.WORKFLOW_UNSAFE_REQUEST,
  ErrorCode.WORKFLOW_TOO_MANY_STEPS,
  ErrorCode.WORKFLOW_ACTION_NOT_ALLOWED,
  ErrorCode.WORKFLOW_SENSITIVE_ACTION,
  ErrorCode.WORKFLOW_APPROVAL_REQUIRED,
  ErrorCode.WORKFLOW_APPROVAL_MISMATCH,
  ErrorCode.WORKFLOW_APPROVAL_EXPIRED,
  ErrorCode.WORKFLOW_CHANGED,
  ErrorCode.WORKFLOW_ALREADY_APPROVED,
  ErrorCode.WORKFLOW_INVALID_TRANSITION,
  ErrorCode.WORKFLOW_UNKNOWN_STEP,
  ErrorCode.WORKFLOW_ALREADY_RUNNING,
  ErrorCode.WORKFLOW_CONFLICT,
  ErrorCode.WORKFLOW_STATE_INVALID,
  ErrorCode.WORKFLOW_ALREADY_COMPLETED,
  ErrorCode.WORKFLOW_EXPIRED,
  ErrorCode.WORKFLOW_CONTEXT_CHANGED,
  ErrorCode.WORKFLOW_TAB_CHANGED,
  ErrorCode.WORKFLOW_TARGET_AMBIGUOUS,
  ErrorCode.WORKFLOW_TARGET_NOT_FOUND,
  ErrorCode.WORKFLOW_STEP_FAILED,
  ErrorCode.WORKFLOW_VERIFICATION_FAILED,
  ErrorCode.WORKFLOW_LIMIT_EXCEEDED,
  ErrorCode.WORKFLOW_TIMEOUT,
  ErrorCode.WORKFLOW_BLOCKED,
  ErrorCode.WORKFLOW_CANCELLED,
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export interface WorkflowError {
  code: WorkflowErrorCode;
  /** User-safe message; never contains raw internals. */
  message: string;
}

export function isWorkflowErrorCode(value: unknown): value is WorkflowErrorCode {
  return (
    typeof value === 'string' &&
    (WORKFLOW_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Build a typed workflow error from the shared, user-safe vocabulary.
 * The optional message must also be user-safe (a verification detail or
 * a bounded label), never a raw exception.
 */
export function workflowError(
  code: WorkflowErrorCode,
  message?: string,
): WorkflowError {
  return { code, message: message ?? USER_ERROR_MESSAGES[code] };
}

/**
 * Coerce an unknown thrown value into a workflow error. Unknown failures
 * become WORKFLOW_INVALID: honest, safe, and never a raw message.
 */
export function toWorkflowError(error: unknown): WorkflowError {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    isWorkflowErrorCode((error as { code: unknown }).code)
  ) {
    const code = (error as { code: WorkflowErrorCode }).code;
    return { code, message: USER_ERROR_MESSAGES[code] };
  }
  return workflowError('WORKFLOW_INVALID');
}

/**
 * Map a Phase 4 executor failure onto the workflow vocabulary. The
 * executor stays the single security boundary; the workflow layer only
 * translates its typed result for the transcript.
 */
export function workflowErrorForActionCode(code: string): WorkflowError {
  switch (code) {
    case 'ACTION_PERMISSION_DENIED':
      return workflowError('WORKFLOW_APPROVAL_REQUIRED');
    case 'ACTION_PERMISSION_EXPIRED':
      return workflowError('WORKFLOW_APPROVAL_EXPIRED');
    case 'ACTION_PLAN_CHANGED':
      return workflowError('WORKFLOW_CHANGED');
    case 'ACTION_PLAN_UNKNOWN':
      return workflowError('WORKFLOW_UNKNOWN');
    case 'ACTION_CONTEXT_STALE':
      return workflowError('WORKFLOW_CONTEXT_CHANGED');
    case 'ACTION_TARGET_AMBIGUOUS':
      return workflowError('WORKFLOW_TARGET_AMBIGUOUS');
    case 'ACTION_TARGET_NOT_FOUND':
      return workflowError('WORKFLOW_TARGET_NOT_FOUND');
    case 'ACTION_SENSITIVE_FIELD':
      return workflowError('WORKFLOW_SENSITIVE_ACTION');
    case 'ACTION_VERIFICATION_FAILED':
      return workflowError('WORKFLOW_VERIFICATION_FAILED');
    case 'ACTION_LIMIT_EXCEEDED':
      return workflowError('WORKFLOW_LIMIT_EXCEEDED');
    case 'ACTION_NOT_ALLOWED':
    case 'ACTION_INVALID':
      return workflowError('WORKFLOW_ACTION_NOT_ALLOWED');
    default:
      return workflowError('WORKFLOW_STEP_FAILED');
  }
}
