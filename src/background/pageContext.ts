import { parsePageContext } from '@/page-intelligence';
import {
  isExtractPageResponseSuccess,
  buildExtractPageRequest,
} from '@/page-intelligence/protocol';
import type { PageSection } from '@/shared/types/page';
import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';

/**
 * Read the active tab's title/URL (requires the narrow `tabs` permission)
 * and convert it into a sanitized basic PageContext. Degrades gracefully
 * when the tabs API is unavailable (dev preview) or the tab exposes no URL.
 */
export async function getCurrentPage(): Promise<PageContext> {
  const now = new Date();

  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return { ...buildPageContext({}, now), state: 'unavailable', reason: 'no-tab' };
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      return { ...buildPageContext({}, now), state: 'unavailable', reason: 'no-tab' };
    }
    return buildPageContext({ title: tab.title, url: tab.url }, now);
  } catch {
    return { ...buildPageContext({}, now), state: 'unavailable', reason: 'error' };
  }
}

async function getActiveTab(): Promise<{ id: number; title?: string; url?: string } | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') return null;
    return { id: tab.id, title: tab.title, url: tab.url };
  } catch {
    return null;
  }
}

/** Active tab id (Phase 4 freshness binding) or undefined. */
export async function getActiveTabId(): Promise<number | undefined> {
  const tab = await getActiveTab();
  return tab?.id;
}

/**
 * Page Intelligence capture (Phase 2).
 *
 * Flow: tabs API → URL gate → one tabs.sendMessage to the content script →
 * strict parsePageContext validation of the response.
 *
 *   - no tab / no tabs API        → unavailable (no-tab)
 *   - browser-internal / bad URL  → unsupported / unavailable (tabs-only)
 *   - no content script channel   → unavailable (no-content-script)
 *   - channel present, no reply   → permission-required (site access may be
 *                                   restricted by the user)
 *   - reply fails validation      → unavailable (error) — nothing untrusted
 *                                   ever reaches the UI
 *
 * One request → one controlled extraction → one sanitized result.
 */
export async function getPageContext(
  options: { sections?: readonly PageSection[] | null } = {},
): Promise<PageContext> {
  const now = new Date();
  const tab = await getActiveTab();

  if (!tab) {
    return { ...buildPageContext({}, now), state: 'unavailable', reason: 'no-tab' };
  }

  const basic = buildPageContext({ title: tab.title, url: tab.url }, now);
  if (basic.state !== 'ready') return basic;

  const sendMessage =
    typeof chrome !== 'undefined' ? chrome.tabs?.sendMessage : undefined;
  if (typeof sendMessage !== 'function') {
    return { ...basic, state: 'unavailable', reason: 'no-content-script' };
  }

  try {
    const response = await sendMessage(
      tab.id,
      buildExtractPageRequest(options.sections ?? null),
    );

    if (!isExtractPageResponseSuccess(response)) {
      return { ...basic, state: 'unavailable', reason: 'no-content-script' };
    }

    const parsed = parsePageContext(response.context);
    if (!parsed) {
      // Malformed or policy-violating payload — drop it entirely.
      return { ...basic, state: 'unavailable', reason: 'error' };
    }

    // Tabs-API values win when the extractor left them empty (defensive).
    return {
      ...parsed,
      url: parsed.url ?? basic.url,
      hostname: parsed.hostname ?? basic.hostname,
      title: parsed.title ?? basic.title,
    };
  } catch {
    // "Receiving end does not exist": the content script is not present on
    // this page — usually because the user restricted site access.
    return { ...basic, state: 'permission-required', reason: 'permission' };
  }
}
