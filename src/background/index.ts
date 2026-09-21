/**
 * CommandLayer background service worker (Manifest V3, module type).
 *
 * Responsibilities:
 * - extension lifecycle (install/first run)
 * - typed message routing (popup / side panel / command center → handlers)
 * - command dispatching foundation
 * - keyboard command → open/focus the CommandLayer experience
 *
 * No business logic lives here beyond wiring; the handlers in ./handlers
 * are pure and unit-testable.
 */
import { ensureDefaultSettings } from '@/storage/settings';
import { handleBackgroundMessage } from './handlers';
import {
  openCommandCenterTab,
  openSidePanelForActiveTab,
} from './openers';

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  // Returning a Promise lets chrome.runtime.sendMessage callers await it.
  return handleBackgroundMessage(message, sender);
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings();
});

/**
 * Keyboard shortcut (Ctrl+Shift+L / Cmd+Shift+L on macOS).
 *
 * Opens the Side Panel for the active tab — the primary Phase 1 experience.
 * If the side panel cannot be opened (unsupported build, no active tab),
 * falls back to the Command Center tab so the shortcut always does something.
 */
async function openCommandLayerExperience(): Promise<void> {
  try {
    await openSidePanelForActiveTab();
  } catch {
    try {
      await openCommandCenterTab();
    } catch {
      // Nothing else is possible without browser APIs; fail silently.
    }
  }
}

chrome.commands.onCommand.addListener((command: string) => {
  if (command === 'open-command-layer') {
    void openCommandLayerExperience();
  }
});
