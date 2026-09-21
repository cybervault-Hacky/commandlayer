import type { MessageType } from '../constants/messages';
import type { QuickActionId } from '../constants/quickActions';
import type { CommandSource } from './command';
import type { CommandResult } from './command';
import type { PageContext, PageSection } from './page';
import type { Settings, SettingsPatch } from './settings';
import type { ExtensionStatus } from './status';
import type { ErrorCode } from '../constants/errors';

/**
 * Every message in CommandLayer uses one envelope shape. The background
 * never assumes an incoming message is valid — envelopes are parsed and
 * rejected safely (see @/shared/messaging/validation).
 */
export interface MessageEnvelope<TType extends string = string> {
  v: 1;
  /** Request id, used for future request/response correlation. */
  id: string;
  type: TType;
  payload?: unknown;
}

export interface MessageError {
  code: ErrorCode;
  /** User-safe message. */
  message: string;
}

export type MessageSuccess<T> = { ok: true; data: T };
export type MessageFailure = { ok: false; error: MessageError };
export type MessageResult<T> = MessageSuccess<T> | MessageFailure;

/** Payloads */
export interface CommandSubmitPayload {
  text: string;
  source: CommandSource;
  quickAction?: QuickActionId;
}

export interface QuickActionPayload {
  actionId: QuickActionId;
  source: CommandSource;
}

export interface NoPayload {
  [key: string]: never;
}

/** The full typed request/response map. */
export interface MessageMap {
  [MessageType.PING]: {
    payload: NoPayload;
    result: { pong: true; version: string };
  };
  [MessageType.GET_EXTENSION_STATUS]: {
    payload: NoPayload;
    result: ExtensionStatus;
  };
  [MessageType.GET_CURRENT_PAGE]: {
    payload: NoPayload;
    result: PageContext;
  };
  [MessageType.GET_PAGE_CONTEXT]: {
    payload: { sections?: PageSection[] };
    result: PageContext;
  };
  [MessageType.COMMAND_SUBMIT]: {
    payload: CommandSubmitPayload;
    result: CommandResult;
  };
  [MessageType.QUICK_ACTION]: {
    payload: QuickActionPayload;
    result: CommandResult;
  };
  [MessageType.OPEN_COMMAND_CENTER]: {
    payload: NoPayload;
    result: { opened: true };
  };
  [MessageType.OPEN_SIDE_PANEL]: {
    payload: NoPayload;
    result: { opened: true };
  };
  [MessageType.GET_SETTINGS]: {
    payload: NoPayload;
    result: Settings;
  };
  [MessageType.SET_SETTINGS]: {
    payload: { patch: SettingsPatch };
    result: Settings;
  };
}

export type MessagePayload<T extends MessageType> = MessageMap[T]['payload'];
export type MessageResultData<T extends MessageType> = MessageMap[T]['result'];
