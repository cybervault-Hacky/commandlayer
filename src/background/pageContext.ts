import { buildPageContext } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';

/**
 * Read the active tab's title/URL (requires the narrow `tabs` permission)
 * and convert it into a sanitized PageContext. Degrades gracefully when the
 * tabs API is unavailable (dev preview) or the tab exposes no URL.
 */
export async function getCurrentPage(): Promise<PageContext> {
  const now = new Date();

  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return { state: 'unavailable', reason: 'no-tab', fetchedAt: now.toISOString() };
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      return { state: 'unavailable', reason: 'no-tab', fetchedAt: now.toISOString() };
    }
    return buildPageContext({ title: tab.title, url: tab.url }, now);
  } catch {
    return { state: 'unavailable', reason: 'error', fetchedAt: now.toISOString() };
  }
}
