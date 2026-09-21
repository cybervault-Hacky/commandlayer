import {
  ErrorCode,
  USER_ERROR_MESSAGES,
  type ErrorCode as ErrorCodeType,
} from '../constants/errors';

/**
 * Domain error carrying a stable code. Anything thrown as a CommandLayerError
 * is considered safe to surface to the user; everything else is sanitized to
 * a generic message (no stack traces, no internals).
 */
export class CommandLayerError extends Error {
  readonly code: ErrorCodeType;

  constructor(code: ErrorCodeType, message: string) {
    super(message);
    this.name = 'CommandLayerError';
    this.code = code;
  }
}

export interface UserFacingError {
  code: ErrorCodeType;
  message: string;
}

/** Convert any thrown value into something the UI may display. */
export function toUserFacingError(error: unknown): UserFacingError {
  if (error instanceof CommandLayerError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: ErrorCode.UNEXPECTED_ERROR,
    message: USER_ERROR_MESSAGES[ErrorCode.UNEXPECTED_ERROR],
  };
}
