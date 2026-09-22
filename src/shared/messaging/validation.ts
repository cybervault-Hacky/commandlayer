import {
  MESSAGE_VERSION,
  MessageType,
} from '../constants/messages';
import {
  ErrorCode,
  USER_ERROR_MESSAGES,
  type ErrorCode as ErrorCodeType,
} from '../constants/errors';
import type {
  MessageEnvelope,
  MessageResult,
} from '../types/message';

const VALID_TYPES: ReadonlySet<string> = new Set(
  Object.values(MessageType),
);
const MAX_MESSAGE_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an untrusted raw message into a valid envelope, or return null.
 * Never throws.
 */
export function parseMessage(raw: unknown): MessageEnvelope | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== MESSAGE_VERSION) return null;
  if (
    typeof raw.id !== 'string' ||
    raw.id.length === 0 ||
    raw.id.length > MAX_MESSAGE_ID_LENGTH
  ) {
    return null;
  }
  if (typeof raw.type !== 'string' || !VALID_TYPES.has(raw.type)) return null;

  const message: MessageEnvelope = {
    v: MESSAGE_VERSION,
    id: raw.id,
    type: raw.type,
  };
  if (raw.payload !== undefined) message.payload = raw.payload;
  return message;
}

/** Parse an untrusted raw message *response* into a result envelope. */
export function parseMessageResult<T = unknown>(
  raw: unknown,
): MessageResult<T> | null {
  if (!isRecord(raw)) return null;
  if (raw.ok === true && 'data' in raw) {
    return { ok: true, data: raw.data as T };
  }
  if (raw.ok === false) {
    const error = raw.error;
    if (isRecord(error) && typeof error.code === 'string') {
      return {
        ok: false,
        error: {
          code: (error.code in USER_ERROR_MESSAGES
            ? error.code
            : ErrorCode.UNEXPECTED_ERROR) as ErrorCodeType,
          message:
            typeof error.message === 'string' && error.message.length > 0
              ? error.message.slice(0, 300)
              : USER_ERROR_MESSAGES[ErrorCode.UNEXPECTED_ERROR],
        },
      };
    }
  }
  return null;
}

export function toMessageResult<T>(data: T): MessageResult<T> {
  return { ok: true, data };
}

export function toMessageFailure(
  code: ErrorCodeType,
  message?: string,
): MessageResult<never> {
  return {
    ok: false,
    error: { code, message: message ?? USER_ERROR_MESSAGES[code] },
  };
}
