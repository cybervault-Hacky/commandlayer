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
  UNEXPECTED_ERROR: 'Something went wrong. Please try again.',
};
