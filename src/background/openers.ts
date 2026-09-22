import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { CommandLayerError } from '@/shared/security/errors';

/**
 * Open/focus helpers. Each throws a user-safe CommandLayerError when the
 * browser API is unavailable (e.g. plain-browser dev preview).
 */
export async function openCommandCenterTab(): Promise<{ opened: true }> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
    throw new CommandLayerError(
      ErrorCode.EXTENSION_ACTION_UNAVAILABLE,
      USER_ERROR_MESSAGES[ErrorCode.EXTENSION_ACTION_UNAVAILABLE],
    );
  }
  const url = chrome.runtime.getURL('command-center.html');
  await chrome.tabs.create({ url, active: true });
  return { opened: true };
}

/**
 * Open the Side Panel for the active tab, falling back to the current
 * window. (Modern type revisions require an explicit tabId/windowId target.)
 */
export async function openSidePanelForActiveTab(): Promise<{ opened: true }> {
  if (
    typeof chrome === 'undefined' ||
    typeof chrome.sidePanel?.open !== 'function'
  ) {
    throw new CommandLayerError(
      ErrorCode.EXTENSION_ACTION_UNAVAILABLE,
      USER_ERROR_MESSAGES[ErrorCode.EXTENSION_ACTION_UNAVAILABLE],
    );
  }

  let tabId: number | undefined;
  if (chrome.tabs?.query) {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      tabId = tab?.id;
    } catch {
      tabId = undefined;
    }
  }

  let windowId: number | undefined;
  if (tabId === undefined && chrome.windows?.getCurrent) {
    try {
      windowId = (await chrome.windows.getCurrent()).id;
    } catch {
      windowId = undefined;
    }
  }

  try {
    if (tabId !== undefined) {
      await chrome.sidePanel.open({ tabId });
    } else if (windowId !== undefined) {
      await chrome.sidePanel.open({ windowId });
    } else {
      throw new CommandLayerError(
        ErrorCode.EXTENSION_ACTION_UNAVAILABLE,
        'No window is available to open the side panel in.',
      );
    }
    return { opened: true };
  } catch (error) {
    if (error instanceof CommandLayerError) throw error;
    throw new CommandLayerError(
      ErrorCode.EXTENSION_ACTION_UNAVAILABLE,
      'The side panel could not be opened. You can also open it from the toolbar.',
    );
  }
}
