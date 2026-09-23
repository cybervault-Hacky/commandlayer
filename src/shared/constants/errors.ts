/**
 * Stable error codes shared by the background pipeline and the UI.
 * `USER_ERROR_MESSAGES` is the only place where user-facing wording lives,
 * so the UI never renders raw exceptions or stack traces.
 */
export const ErrorCode = {
  BAD_MESSAGE: 'BAD_MESSAGE',
  UNKNOWN_MESSAGE: 'UNKNOWN_MESSAGE',
  UNAUTHORIZED_SENDER: 'UNAUTHORIZED_SENDER',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  EMPTY_COMMAND: 'EMPTY_COMMAND',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  PAGE_UNAVAILABLE: 'PAGE_UNAVAILABLE',
  EXTENSION_ACTION_UNAVAILABLE: 'EXTENSION_ACTION_UNAVAILABLE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_AUTH_ERROR: 'AI_AUTH_ERROR',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_INVALID_REQUEST: 'AI_INVALID_REQUEST',
  AI_CONTEXT_TOO_LARGE: 'AI_CONTEXT_TOO_LARGE',
  AI_NETWORK_ERROR: 'AI_NETWORK_ERROR',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  AI_CONFIGURATION_ERROR: 'AI_CONFIGURATION_ERROR',
  AI_PAGE_UNAVAILABLE: 'AI_PAGE_UNAVAILABLE',
  AI_CANCELLED: 'AI_CANCELLED',
  ACTION_INVALID: 'ACTION_INVALID',
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
  ACTION_PERMISSION_REQUIRED: 'ACTION_PERMISSION_REQUIRED',
  ACTION_PERMISSION_DENIED: 'ACTION_PERMISSION_DENIED',
  ACTION_PERMISSION_EXPIRED: 'ACTION_PERMISSION_EXPIRED',
  ACTION_PLAN_CHANGED: 'ACTION_PLAN_CHANGED',
  ACTION_PLAN_UNKNOWN: 'ACTION_PLAN_UNKNOWN',
  ACTION_CONTEXT_STALE: 'ACTION_CONTEXT_STALE',
  ACTION_TARGET_NOT_FOUND: 'ACTION_TARGET_NOT_FOUND',
  ACTION_TARGET_AMBIGUOUS: 'ACTION_TARGET_AMBIGUOUS',
  ACTION_SENSITIVE_FIELD: 'ACTION_SENSITIVE_FIELD',
  ACTION_EXECUTION_FAILED: 'ACTION_EXECUTION_FAILED',
  ACTION_VERIFICATION_FAILED: 'ACTION_VERIFICATION_FAILED',
  ACTION_LIMIT_EXCEEDED: 'ACTION_LIMIT_EXCEEDED',
  ACTION_TIMEOUT: 'ACTION_TIMEOUT',
  ACTION_CANCELLED: 'ACTION_CANCELLED',
  ACTION_UNSUPPORTED: 'ACTION_UNSUPPORTED',
  WORKFLOW_INVALID: 'WORKFLOW_INVALID',
  WORKFLOW_UNKNOWN: 'WORKFLOW_UNKNOWN',
  WORKFLOW_TASK_NOT_SUPPORTED: 'WORKFLOW_TASK_NOT_SUPPORTED',
  WORKFLOW_UNSAFE_REQUEST: 'WORKFLOW_UNSAFE_REQUEST',
  WORKFLOW_TOO_MANY_STEPS: 'WORKFLOW_TOO_MANY_STEPS',
  WORKFLOW_ACTION_NOT_ALLOWED: 'WORKFLOW_ACTION_NOT_ALLOWED',
  WORKFLOW_SENSITIVE_ACTION: 'WORKFLOW_SENSITIVE_ACTION',
  WORKFLOW_APPROVAL_REQUIRED: 'WORKFLOW_APPROVAL_REQUIRED',
  WORKFLOW_APPROVAL_MISMATCH: 'WORKFLOW_APPROVAL_MISMATCH',
  WORKFLOW_APPROVAL_EXPIRED: 'WORKFLOW_APPROVAL_EXPIRED',
  WORKFLOW_CHANGED: 'WORKFLOW_CHANGED',
  WORKFLOW_ALREADY_APPROVED: 'WORKFLOW_ALREADY_APPROVED',
  WORKFLOW_INVALID_TRANSITION: 'WORKFLOW_INVALID_TRANSITION',
  WORKFLOW_UNKNOWN_STEP: 'WORKFLOW_UNKNOWN_STEP',
  WORKFLOW_ALREADY_RUNNING: 'WORKFLOW_ALREADY_RUNNING',
  WORKFLOW_CONFLICT: 'WORKFLOW_CONFLICT',
  WORKFLOW_STATE_INVALID: 'WORKFLOW_STATE_INVALID',
  WORKFLOW_ALREADY_COMPLETED: 'WORKFLOW_ALREADY_COMPLETED',
  WORKFLOW_EXPIRED: 'WORKFLOW_EXPIRED',
  WORKFLOW_CONTEXT_CHANGED: 'WORKFLOW_CONTEXT_CHANGED',
  WORKFLOW_TAB_CHANGED: 'WORKFLOW_TAB_CHANGED',
  WORKFLOW_TARGET_AMBIGUOUS: 'WORKFLOW_TARGET_AMBIGUOUS',
  WORKFLOW_TARGET_NOT_FOUND: 'WORKFLOW_TARGET_NOT_FOUND',
  WORKFLOW_STEP_FAILED: 'WORKFLOW_STEP_FAILED',
  WORKFLOW_VERIFICATION_FAILED: 'WORKFLOW_VERIFICATION_FAILED',
  WORKFLOW_LIMIT_EXCEEDED: 'WORKFLOW_LIMIT_EXCEEDED',
  WORKFLOW_TIMEOUT: 'WORKFLOW_TIMEOUT',
  WORKFLOW_BLOCKED: 'WORKFLOW_BLOCKED',
  WORKFLOW_CANCELLED: 'WORKFLOW_CANCELLED',
  /**
   * Phase 6 — memory. Memory has its own closed vocabulary so a memory
   * failure can never be confused with an action or workflow failure.
   */
  MEMORY_INVALID: 'MEMORY_INVALID',
  MEMORY_DISABLED: 'MEMORY_DISABLED',
  MEMORY_LIMIT_EXCEEDED: 'MEMORY_LIMIT_EXCEEDED',
  MEMORY_CONTENT_TOO_LONG: 'MEMORY_CONTENT_TOO_LONG',
  MEMORY_SENSITIVE_BLOCKED: 'MEMORY_SENSITIVE_BLOCKED',
  MEMORY_NOT_FOUND: 'MEMORY_NOT_FOUND',
  MEMORY_STORAGE_FAILED: 'MEMORY_STORAGE_FAILED',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const USER_ERROR_MESSAGES: Record<ErrorCode, string> = {
  BAD_MESSAGE: 'The message received was not valid.',
  UNKNOWN_MESSAGE: 'Unknown message type.',
  UNAUTHORIZED_SENDER: 'This request was not allowed.',
  INVALID_PAYLOAD: 'The request contained invalid data.',
  EMPTY_COMMAND: 'Enter a command first.',
  INVALID_SETTINGS: 'The settings change was not valid.',
  PAGE_UNAVAILABLE: 'No page context is available right now.',
  EXTENSION_ACTION_UNAVAILABLE:
    'This feature is only available when CommandLayer is loaded as a browser extension.',
  AI_UNAVAILABLE: 'Intelligence is unavailable right now.',
  AI_TIMEOUT: 'The request took too long. Please try again.',
  AI_RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  AI_AUTH_ERROR: 'The AI service rejected the connection. Check your gateway configuration.',
  AI_INVALID_RESPONSE: 'The AI service returned an unexpected response.',
  AI_INVALID_REQUEST: 'That request could not be understood. Please rephrase it.',
  AI_CONTEXT_TOO_LARGE: 'This page is too large to analyze right now.',
  AI_NETWORK_ERROR: 'Could not reach the AI service. Check your connection.',
  AI_PROVIDER_ERROR: 'The AI service encountered an error.',
  AI_CONFIGURATION_ERROR: 'The AI service is not configured correctly.',
  AI_PAGE_UNAVAILABLE: 'Page contents are not available to reason about. Open a regular web page and try again.',
  AI_CANCELLED: 'This request was replaced by a newer one.',
  ACTION_INVALID: 'That action is not valid.',
  ACTION_NOT_ALLOWED: 'That action is not allowed.',
  ACTION_PERMISSION_REQUIRED: 'This action needs your explicit approval first.',
  ACTION_PERMISSION_DENIED: 'The action was not approved.',
  ACTION_PERMISSION_EXPIRED: 'The approval expired. Please review the plan again.',
  ACTION_PLAN_CHANGED: 'The plan changed after approval. Please review it again.',
  ACTION_PLAN_UNKNOWN: 'This plan is no longer available.',
  ACTION_CONTEXT_STALE: 'The page changed since this plan was created. Please try again.',
  ACTION_TARGET_NOT_FOUND: 'The target element could not be found on the page.',
  ACTION_TARGET_AMBIGUOUS: 'Several matching elements were found. Be more specific.',
  ACTION_SENSITIVE_FIELD: 'CommandLayer never types into sensitive fields such as passwords or payment details.',
  ACTION_EXECUTION_FAILED: 'The action could not be completed.',
  ACTION_VERIFICATION_FAILED: 'The action ran, but the result could not be verified.',
  ACTION_LIMIT_EXCEEDED: 'The requested action exceeds CommandLayer safety limits.',
  ACTION_TIMEOUT: 'The action took too long and was stopped.',
  ACTION_CANCELLED: 'The action was cancelled.',
  ACTION_UNSUPPORTED: 'That action is not supported in this version.',
  WORKFLOW_INVALID: 'This workflow is not valid.',
  WORKFLOW_UNKNOWN: 'This workflow is no longer available.',
  WORKFLOW_TASK_NOT_SUPPORTED:
    'CommandLayer can’t run that as a workflow. Only its own registered actions can be used.',
  WORKFLOW_UNSAFE_REQUEST:
    'CommandLayer never runs scripts, shell commands, or browser code — only its own registered actions.',
  WORKFLOW_TOO_MANY_STEPS:
    'This task needs more steps than CommandLayer allows for one workflow.',
  WORKFLOW_ACTION_NOT_ALLOWED:
    'This workflow includes an action that is not supported.',
  WORKFLOW_SENSITIVE_ACTION:
    'CommandLayer never types into sensitive fields such as passwords or payment details.',
  WORKFLOW_APPROVAL_REQUIRED:
    'This workflow needs your explicit approval before it can run.',
  WORKFLOW_APPROVAL_MISMATCH:
    'This approval does not match the workflow. Please review it again.',
  WORKFLOW_APPROVAL_EXPIRED:
    'The workflow approval expired. Please review it again.',
  WORKFLOW_CHANGED:
    'The workflow changed after approval. Please review it again.',
  WORKFLOW_ALREADY_APPROVED:
    'This workflow is already approved. Use pause, resume, or cancel to control the run.',
  WORKFLOW_INVALID_TRANSITION:
    'That action does not apply to the workflow’s current state.',
  WORKFLOW_UNKNOWN_STEP: 'That workflow step is no longer available.',
  WORKFLOW_ALREADY_RUNNING:
    'This workflow is already running in this tab.',
  WORKFLOW_CONFLICT:
    'Another workflow is already running in this tab. Finish or cancel it first.',
  WORKFLOW_STATE_INVALID:
    'That step is not possible in the workflow’s current state.',
  WORKFLOW_ALREADY_COMPLETED: 'This workflow has already finished.',
  WORKFLOW_EXPIRED: 'The workflow expired. Please start the task again.',
  WORKFLOW_CONTEXT_CHANGED:
    'The page changed unexpectedly, so the workflow was stopped.',
  WORKFLOW_TAB_CHANGED:
    'The active tab changed, so the workflow was stopped.',
  WORKFLOW_TARGET_AMBIGUOUS:
    'Several elements matched. The workflow stopped instead of guessing.',
  WORKFLOW_TARGET_NOT_FOUND:
    'I couldn’t identify a single matching element on this page.',
  WORKFLOW_STEP_FAILED: 'A workflow step failed. Nothing after it ran.',
  WORKFLOW_VERIFICATION_FAILED:
    'A step ran, but its result could not be verified. The workflow stopped.',
  WORKFLOW_LIMIT_EXCEEDED:
    'The workflow reached a CommandLayer safety limit and was stopped.',
  WORKFLOW_TIMEOUT: 'The workflow took too long and was stopped.',
  WORKFLOW_BLOCKED: 'The workflow was blocked for safety.',
  WORKFLOW_CANCELLED: 'The workflow was cancelled.',
  MEMORY_INVALID: 'That memory could not be saved.',
  MEMORY_DISABLED:
    'Memory is off. Turn it on in Settings to save or use personal memory.',
  MEMORY_LIMIT_EXCEEDED:
    'You’ve reached the saved-memory limit. Delete a memory first, or clear all memory in Settings.',
  MEMORY_CONTENT_TOO_LONG:
    'Memories are short by design — keep it to a sentence or two.',
  MEMORY_SENSITIVE_BLOCKED:
    'I can’t save passwords, codes, payment details, keys, or tokens as memory.',
  MEMORY_NOT_FOUND: 'That memory is no longer saved.',
  MEMORY_STORAGE_FAILED:
    'Saved memories could not be read or written right now.',
  UNEXPECTED_ERROR: 'Something went wrong. Please try again.',
};
