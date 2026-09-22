import { type MessageType } from '../constants/messages';
import type {
  MessagePayload,
  MessageResult,
  MessageResultData,
} from '../types/message';
import { getTransport } from './transport';

/**
 * The single entry point for UI code to talk to the background.
 * Always returns a discriminated MessageResult — never throws for
 * transport-level failures.
 */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload?: MessagePayload<T>,
): Promise<MessageResult<MessageResultData<T>>> {
  return getTransport().send(type, payload);
}
