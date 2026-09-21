/**
 * Content script (Phase 2 — Page Intelligence).
 *
 * Registered in the manifest for http/https pages only (see
 * public/manifest.json → content_scripts). It does exactly one thing:
 * when the background sends an EXTRACT_PAGE_REQUEST, it runs the Page
 * Intelligence Engine once on the live document and replies with a
 * sanitized, limit-capped PageContext.
 *
 * Hard invariants (enforced by construction, not by convention):
 * - ON DEMAND only: no listeners for user activity, no observers, no polling
 * - extraction only: no AI calls, no network requests, no command execution
 * - no side effects: no clicks, no form submission, no DOM modification
 * - no secrets: no input values (ever), no cookies, no storage, no history
 * - strict input: anything that is not a valid ExtractPageRequest is
 *   ignored — the script never responds to unknown message shapes
 */
import { extractPageContext } from '@/page-intelligence';
import {
  isExtractPageRequest,
  type ExtractPageResponse,
} from '@/page-intelligence/protocol';

type SendResponse = (response: ExtractPageResponse) => void;

/**
 * Handle one inbound raw message. Synchronous: sendResponse is always
 * called exactly once (or not at all for foreign messages).
 */
export function handleContentMessage(raw: unknown, sendResponse: SendResponse): void {
  if (!isExtractPageRequest(raw)) return; // foreign message — stay silent

  try {
    const context = extractPageContext(document, {
      sections: raw.sections,
    });
    sendResponse({ ok: true, context });
  } catch {
    // A hostile or broken page must never take the extension down.
    sendResponse({ ok: false, error: 'extraction-failed' });
  }
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
