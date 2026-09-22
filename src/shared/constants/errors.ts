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
  UNEXPECTED_ERROR: 'Something went wrong. Please try again.',
};
