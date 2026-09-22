import { type MessageType } from '../constants/messages';
import type {
  MessagePayload,
  MessageResult,
  MessageResultData,
} from '../types/message';
import { createMessage } from './envelope';
import { parseMessageResult, toMessageFailure } from './validation';
import { ErrorCode } from '../constants/errors';
import {
  handleBackgroundMessage,
  type BackgroundSender,
} from '@/background/handlers';

/**
 * The message layer.
 *
 * UI surface ──▶ MessageTransport ──▶ Background service worker
 *
 * - ChromeTransport: real extension context, uses chrome.runtime.sendMessage.
 * - LocalTransport: plain-browser dev preview (`npm run dev`) and tests —
 *   invokes the same background handler in-process so the full pipeline
 *   (validation, dispatch, mock AI) runs identically without a browser API.
 */
export interface MessageTransport {
  send<T extends MessageType>(
    type: T,
    payload?: MessagePayload<T>,
  ): Promise<MessageResult<MessageResultData<T>>>;
}

export const LOCAL_PREVIEW_SENDER_ID = 'local-preview';

class ChromeTransport implements MessageTransport {
  async send<T extends MessageType>(
    type: T,
    payload?: MessagePayload<T>,
  ): Promise<MessageResult<MessageResultData<T>>> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return toMessageFailure(ErrorCode.UNEXPECTED_ERROR);
    }
    try {
      const raw = await chrome.runtime.sendMessage(createMessage(type, payload));
      const parsed = parseMessageResult<MessageResultData<T>>(raw);
      return (
        parsed ??
        toMessageFailure(
          ErrorCode.BAD_MESSAGE,
          'Received an unexpected response from the background service.',
        )
      );
    } catch {
      return toMessageFailure(
        ErrorCode.UNEXPECTED_ERROR,
        'The background service is unavailable.',
      );
    }
  }
}

class LocalTransport implements MessageTransport {
  async send<T extends MessageType>(
    type: T,
    payload?: MessagePayload<T>,
  ): Promise<MessageResult<MessageResultData<T>>> {
    const message = createMessage(type, payload);
    const sender: BackgroundSender = { id: LOCAL_PREVIEW_SENDER_ID };
    const raw = await handleBackgroundMessage(message, sender);
    return (
      parseMessageResult<MessageResultData<T>>(raw) ??
      toMessageFailure(ErrorCode.BAD_MESSAGE)
    );
  }
}

let cachedTransport: MessageTransport | null = null;

/** True when a real extension runtime is present. */
export function hasExtensionRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome.runtime?.id &&
    typeof chrome.runtime?.sendMessage === 'function'
  );
}

export function getTransport(): MessageTransport {
  if (!cachedTransport) {
    cachedTransport = hasExtensionRuntime()
      ? new ChromeTransport()
      : new LocalTransport();
  }
  return cachedTransport;
}

/** Test seam: force re-detection of the runtime after stubbing chrome. */
export function __resetTransportForTests(): void {
  cachedTransport = null;
}
