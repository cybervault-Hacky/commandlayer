/**
 * Content script (Phase 2 — Page Intelligence, Phase 4 — Safe Actions).
 *
 * Registered in the manifest for http/https pages only (see
 * public/manifest.json → content_scripts). It answers exactly two
 * message kinds:
 *
 *  - EXTRACT_PAGE_REQUEST: one read-only Page Intelligence pass
 *  - EXECUTE_ACTION_REQUEST: one validated, bounded action step
 *
 * Hard invariants (enforced by construction, not by convention):
 * - ON DEMAND only: no listeners for user activity, no observers, no polling
 * - no AI calls, no network requests
 * - no executable payloads: action requests carry only the closed typed
 *   action union and are re-validated here before any DOM access
 * - no secrets: input values are never collected or returned; sensitive
 *   fields are blocked before typing; responses carry statuses, counts,
 *   and booleans only
 * - strict input: anything that is not a valid request shape is ignored
 *   — the script never responds to unknown messages
 */
import { extractPageContext } from '@/page-intelligence';
import {
  isExtractPageRequest,
  type ExtractPageResponse,
} from '@/page-intelligence/protocol';
import { executeActionStep } from '@/actions/runtime';
import {
  isExecuteActionRequest,
} from '@/actions/protocol';
import type { ContentActionResponse } from '@/actions/types';

type SendResponse = (response: ExtractPageResponse | ContentActionResponse) => void;

/**
 * Handle one inbound raw message. Synchronous: sendResponse is always
 * called exactly once (or not at all for foreign messages).
 */
export function handleContentMessage(raw: unknown, sendResponse: SendResponse): void {
  if (isExtractPageRequest(raw)) {
    try {
      const context = extractPageContext(document, {
        sections: raw.sections,
      });
      sendResponse({ ok: true, context });
    } catch {
      // A hostile or broken page must never take the extension down.
      sendResponse({ ok: false, error: 'extraction-failed' });
    }
    return;
  }

  if (isExecuteActionRequest(raw)) {
    // The wire validator already rejected executable-content keys; the
    // runtime re-validates the action before touching the DOM.
    const response = executeActionStep(raw.action, document);
    sendResponse(response);
    return;
  }

  // Foreign message — stay silent.
}

function registerListener(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener(
        (message: unknown, _sender: unknown, sendResponse: SendResponse) => {
          handleContentMessage(message, sendResponse);
        },
      );
    }
  } catch {
    // Registration can only fail in exotic/embedded contexts; the rest of
    // the extension (tabs-API basic context) still works without it.
  }
}

registerListener();
