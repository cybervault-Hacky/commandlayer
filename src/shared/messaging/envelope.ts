import {
  MESSAGE_VERSION,
  type MessageType,
} from '../constants/messages';
import type { MessageEnvelope, MessagePayload } from '../types/message';

/** Create a unique request id (crypto-backed when available). */
export function createRequestId(prefix = 'cl'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to the counter-based id below.
    }
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a versioned, id-tagged message envelope. */
export function createMessage<T extends MessageType>(
  type: T,
  payload?: MessagePayload<T>,
): MessageEnvelope<T> {
  return {
    v: MESSAGE_VERSION,
    id: createRequestId(),
    type,
    ...(payload !== undefined ? { payload } : {}),
  };
}
