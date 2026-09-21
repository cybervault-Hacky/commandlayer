import { PAGE_CONTEXT_TITLE_MAX } from './constants/app';
import { displayHostname, sanitizeText } from './security/sanitize';
import {
  isUnsupportedPageUrl,
  parseSafeUrl,
} from './security/url';
import type { PageContext } from './types/page';

/** Raw values as they arrive from a tab or document — never trusted. */
export interface PageContextInput {
  title?: unknown;
  url?: unknown;
}

/**
 * Pure, deterministic page-context builder. All input is validated and
 * sanitized; unknown/unsafe values degrade to 'unavailable' instead of
 * throwing.
 */
export function buildPageContext(
  input: PageContextInput,
  now: Date = new Date(),
): PageContext {
  const fetchedAt = now.toISOString();
  const title = sanitizeText(input.title, PAGE_CONTEXT_TITLE_MAX) ?? undefined;
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';

  if (rawUrl.length === 0) {
    return { state: 'unavailable', reason: 'no-tab', title, fetchedAt };
  }

  const safeUrl = parseSafeUrl(rawUrl);
  if (safeUrl) {
    return {
      state: 'ready',
      title,
      url: safeUrl.href,
      hostname: displayHostname(safeUrl.hostname),
      fetchedAt,
    };
  }

  if (isUnsupportedPageUrl(rawUrl)) {
    return {
      state: 'unsupported',
      title,
      url: rawUrl,
      reason: 'browser-page',
      fetchedAt,
    };
  }

  return { state: 'unavailable', title, reason: 'error', fetchedAt };
}
