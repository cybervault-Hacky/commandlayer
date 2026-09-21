import { PAGE_CONTEXT_TITLE_MAX } from './constants/app';
import { displayHostname, sanitizeText } from './security/sanitize';
import {
  isUnsupportedPageUrl,
  parseSafeUrl,
} from './security/url';
import {
  createEmptyPageContext,
  type PageContext,
  type PageContextState,
} from './types/page';

/** Raw values as they arrive from a tab or document — never trusted. */
export interface PageContextInput {
  title?: unknown;
  url?: unknown;
}

function basicContext(
  fields: Partial<PageContext> & { state: PageContextState },
  now: Date,
): PageContext {
  return {
    ...createEmptyPageContext(),
    capturedAt: now.toISOString(),
    ...fields,
  };
}

/**
 * Pure, deterministic BASIC page-context builder (tabs-API data only).
 * All input is validated and sanitized; unknown/unsafe values degrade to
 * 'unavailable' instead of throwing. Intelligence sections are empty —
 * they are filled by the Page Intelligence Engine on demand.
 */
export function buildPageContext(
  input: PageContextInput,
  now: Date = new Date(),
): PageContext {
  const title =
    sanitizeText(input.title, PAGE_CONTEXT_TITLE_MAX) ?? undefined;
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';

  if (rawUrl.length === 0) {
    return basicContext({ state: 'unavailable', reason: 'no-tab', title }, now);
  }

  const safeUrl = parseSafeUrl(rawUrl);
  if (safeUrl) {
    return basicContext(
      {
        state: 'ready',
        title,
        url: safeUrl.href,
        hostname: displayHostname(safeUrl.hostname),
      },
      now,
    );
  }

  if (isUnsupportedPageUrl(rawUrl)) {
    return basicContext(
      {
        state: 'unsupported',
        title,
        url: rawUrl,
        reason: 'browser-page',
      },
      now,
    );
  }

  return basicContext(
    { state: 'unavailable', title, reason: 'error' },
    now,
  );
}
