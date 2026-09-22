import {
  APP_VERSION,
  COMMAND_TEXT_MAX,
} from '@/shared/constants/app';
import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { MessageType } from '@/shared/constants/messages';
import {
  isQuickActionId,
} from '@/shared/constants/quickActions';
import {
  parseMessage,
  toMessageFailure,
  toMessageResult,
} from '@/shared/messaging/validation';
import {
  CommandLayerError,
  toUserFacingError,
} from '@/shared/security/errors';
import { validateSettingsPatch } from '@/shared/validation/settings';
import { getCommandDispatcher } from '@/commands';
import {
  buildCommandRequest,
  buildQuickActionRequest,
} from '@/commands/requests';
import { getSettings, updateSettings } from '@/storage/settings';
import {
  isPageSection,
  sectionsForIntent,
} from '@/page-intelligence/profiles';
import { resolveIntent, intentForQuickAction } from '@/ai/intents';
import { looksLikeActionRequest } from '@/actions/planner';
import { PageSection } from '@/shared/types/page';
import type {
  CommandSource,
  QuickActionId,
} from '@/shared/types/command';
import type {
  ActionCancelPayload,
  ActionExecutePayload,
  MessageEnvelope,
  MessageResult,
} from '@/shared/types/message';
import { getExtensionStatus } from './status';
import { getCurrentPage, getPageContext, getActiveTabId } from './pageContext';
import { openCommandCenterTab, openSidePanelForActiveTab } from './openers';
import { executeApprovedPlan, cancelPlan } from './actionSession';

const COMMAND_SOURCES: ReadonlySet<string> = new Set([
  'sidepanel',
  'popup',
  'command-center',
]);

/** Minimal sender shape we inspect (never trust the rest). */
export interface BackgroundSender {
  id?: unknown;
  url?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sender trust check.
 *
 * In a real browser the `sender` object is produced by the browser itself:
 * any chrome.runtime message carries sender.id of the extension, never of a
 * web page, so matching against our own extension id is a meaningful bound.
 * The local-preview sender id only exists when the in-process transport is
 * used (dev preview / tests), where no browser-mediated messages can arrive.
 */
export function isTrustedSender(sender: unknown): boolean {
  if (!isRecord(sender)) return false;
  if (sender.id === 'local-preview') return true;
  const runtimeId =
    typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
  return (
    typeof runtimeId === 'string' && runtimeId.length > 0 && sender.id === runtimeId
  );
}

function requireNoPayload(message: MessageEnvelope): void {
  if (message.payload === undefined) return;
  if (isRecord(message.payload) && Object.keys(message.payload).length === 0) {
    return;
  }
  throw new CommandLayerError(
    ErrorCode.INVALID_PAYLOAD,
    USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
  );
}

function isCommandSource(value: unknown): value is CommandSource {
  return typeof value === 'string' && COMMAND_SOURCES.has(value);
}

function validateCommandSubmitPayload(
  payload: unknown,
): { text: string; source: CommandSource; quickAction?: QuickActionId } | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.text !== 'string') return null;
  if (payload.text.length > COMMAND_TEXT_MAX) return null;
  if (!isCommandSource(payload.source)) return null;
  if (payload.quickAction !== undefined && !isQuickActionId(payload.quickAction)) {
    return null;
  }
  return {
    text: payload.text,
    source: payload.source,
    ...(payload.quickAction ? { quickAction: payload.quickAction } : {}),
  };
}

function validateQuickActionPayload(
  payload: unknown,
): { actionId: QuickActionId; source: CommandSource } | null {
  if (!isRecord(payload)) return null;
  if (!isQuickActionId(payload.actionId)) return null;
  if (!isCommandSource(payload.source)) return null;
  return { actionId: payload.actionId, source: payload.source };
}

/**
 * Phase 4 approval payload. Identity only — never a plan body. Even a
 * compromised UI cannot inject a different plan this way.
 */
function validateActionExecutePayload(payload: unknown): ActionExecutePayload | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.planId !== 'string' || payload.planId.length === 0) return null;
  if (typeof payload.planHash !== 'string' || payload.planHash.length === 0) return null;
  if (!isCommandSource(payload.source)) return null;
  return {
    planId: payload.planId,
    planHash: payload.planHash,
    source: payload.source,
  };
}

function validateActionCancelPayload(payload: unknown): ActionCancelPayload | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.planId !== 'string' || payload.planId.length === 0) return null;
  return { planId: payload.planId };
}

const MAX_SECTION_REQUESTS = 7;

function validateGetPageContextPayload(
  payload: unknown,
): { sections?: PageSection[] } | null {
  if (payload === undefined) return {};
  if (!isRecord(payload)) return null;
  if (payload.sections === undefined) return {};
  if (!Array.isArray(payload.sections) || payload.sections.length > MAX_SECTION_REQUESTS) {
    return null;
  }
  for (const section of payload.sections) {
    if (!isPageSection(section)) return null;
  }
  return { sections: payload.sections as PageSection[] };
}

function validateSetSettingsPayload(
  payload: unknown,
): { patch: Record<string, unknown> } | null {
  if (!isRecord(payload)) return null;
  const patch = payload.patch;
  if (!isRecord(patch)) return null;
  const validation = validateSettingsPatch(patch);
  if (!validation.ok) {
    throw new CommandLayerError(
      ErrorCode.INVALID_SETTINGS,
      USER_ERROR_MESSAGES[ErrorCode.INVALID_SETTINGS],
    );
  }
  return { patch };
}

async function dispatchMessage(message: MessageEnvelope): Promise<unknown> {
  switch (message.type) {
    case MessageType.PING: {
      requireNoPayload(message);
      return { pong: true, version: APP_VERSION };
    }

    case MessageType.GET_EXTENSION_STATUS: {
      requireNoPayload(message);
      return getExtensionStatus();
    }

    case MessageType.GET_CURRENT_PAGE: {
      requireNoPayload(message);
      return getCurrentPage();
    }

    case MessageType.GET_PAGE_CONTEXT: {
      const payload = validateGetPageContextPayload(message.payload);
      if (!payload) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      return getPageContext({ sections: payload.sections });
    }

    case MessageType.COMMAND_SUBMIT: {
      const payload = validateCommandSubmitPayload(message.payload);
      if (!payload) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      // Every command is a user-initiated request → one on-demand capture
      // of the active page, scoped to what the command needs. Action-
      // shaped commands use the planning profile (the same profile the
      // executor re-captures for freshness checks); reasoning commands
      // use the sections their intent needs. Forms are never captured
      // for the AI pipeline.
      const isActionRequest = looksLikeActionRequest(payload.text);
      const intent =
        payload.quickAction !== undefined
          ? intentForQuickAction(payload.quickAction) ??
            resolveIntent(payload.text)
          : resolveIntent(payload.text);
      const sections = isActionRequest
        ? ([PageSection.Metadata, PageSection.Headings, PageSection.Text] as const)
        : sectionsForIntent(intent);
      const [context, tabId] = await Promise.all([
        getPageContext({ sections: [...sections] }),
        getActiveTabId(),
      ]);
      const request = buildCommandRequest({
        text: payload.text,
        source: payload.source,
        quickAction: payload.quickAction,
        context,
        ...(tabId !== undefined ? { tabId } : {}),
      });
      return getCommandDispatcher().dispatch(request);
    }

    case MessageType.QUICK_ACTION: {
      const payload = validateQuickActionPayload(message.payload);
      if (!payload) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      // Each quick action requests only the sections its intent needs.
      const intent = intentForQuickAction(payload.actionId);
      if (!intent) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      const context = await getPageContext({
        sections: [...sectionsForIntent(intent)],
      });
      const request = buildQuickActionRequest(
        payload.actionId,
        payload.source,
        context,
      );
      return getCommandDispatcher().dispatch(request);
    }

    case MessageType.ACTION_EXECUTE: {
      const payload = validateActionExecutePayload(message.payload);
      if (!payload) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      return executeApprovedPlan({
        planId: payload.planId,
        planHash: payload.planHash,
        source: payload.source,
      });
    }

    case MessageType.ACTION_CANCEL: {
      const payload = validateActionCancelPayload(message.payload);
      if (!payload) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      cancelPlan(payload.planId);
      return { cancelled: true };
    }

    case MessageType.OPEN_COMMAND_CENTER: {
      requireNoPayload(message);
      return openCommandCenterTab();
    }

    case MessageType.OPEN_SIDE_PANEL: {
      requireNoPayload(message);
      return openSidePanelForActiveTab();
    }

    case MessageType.GET_SETTINGS: {
      requireNoPayload(message);
      return getSettings();
    }

    case MessageType.SET_SETTINGS: {
      const payload = validateSetSettingsPayload(message.payload);
      if (!payload) {
        throw new CommandLayerError(
          ErrorCode.INVALID_PAYLOAD,
          USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
        );
      }
      return updateSettings(payload.patch);
    }

    default:
      // Unreachable for parsed envelopes (parseMessage already rejects
      // unknown types), kept as a defensive boundary.
      throw new CommandLayerError(
        ErrorCode.UNKNOWN_MESSAGE,
        USER_ERROR_MESSAGES[ErrorCode.UNKNOWN_MESSAGE],
      );
  }
}

/**
 * Entry point for chrome.runtime.onMessage. Parses and validates the raw
 * message, checks the sender, dispatches, and always returns a
 * well-formed MessageResult — never throws into the browser API.
 */
export async function handleBackgroundMessage(
  raw: unknown,
  sender: unknown,
): Promise<MessageResult<unknown>> {
  const message = parseMessage(raw);
  if (!message) return toMessageFailure(ErrorCode.BAD_MESSAGE);
  if (!isTrustedSender(sender)) {
    return toMessageFailure(ErrorCode.UNAUTHORIZED_SENDER);
  }
  try {
    const data = await dispatchMessage(message);
    return toMessageResult(data);
  } catch (error) {
    const safe = toUserFacingError(error);
    return toMessageFailure(safe.code, safe.message);
  }
}
