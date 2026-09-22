/**
 * Raw wire protocol between the background service worker and the content
 * script. This crosses a trust boundary in BOTH directions:
 *
 *  - background → content: `buildExtractPageRequest` (typed builder only)
 *  - content → background: responses are re-parsed by `parsePageContext`
 *
 * The message shape is deliberately tiny: one request kind, sections
 * hint, and one structured response.
 */
import type { PageContext, PageSection } from '@/shared/types/page';

export const CONTENT_PROTOCOL_VERSION = 1 as const;
export const EXTRACT_PAGE_REQUEST_TYPE = 'cl:extract-page-context-request';

export interface ExtractPageRequest {
  v: typeof CONTENT_PROTOCOL_VERSION;
  type: typeof EXTRACT_PAGE_REQUEST_TYPE;
  /** null = all sections; a subset = extract only these (on-demand). */
  sections: PageSection[] | null;
}

export type ExtractPageResponse =
  | { ok: true; context: PageContext }
  | { ok: false; error: 'extraction-failed' };

const VALID_SECTIONS: ReadonlySet<string> = new Set([
  'metadata',
  'headings',
  'text',
  'links',
  'tables',
  'forms',
  'selection',
]);

export function buildExtractPageRequest(
  sections?: readonly PageSection[] | null,
): ExtractPageRequest {
  if (!sections || sections.length === 0) {
    return {
      v: CONTENT_PROTOCOL_VERSION,
      type: EXTRACT_PAGE_REQUEST_TYPE,
      sections: null,
    };
  }
  const list = sections.filter((s) => VALID_SECTIONS.has(s));
  return {
    v: CONTENT_PROTOCOL_VERSION,
    type: EXTRACT_PAGE_REQUEST_TYPE,
    sections: list.length > 0 ? [...list] : null,
  };
}

/** Strict check for an inbound raw message from the background. */
export function isExtractPageRequest(value: unknown): value is ExtractPageRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.v !== CONTENT_PROTOCOL_VERSION) return false;
  if (record.type !== EXTRACT_PAGE_REQUEST_TYPE) return false;
  if (record.sections === null) return true;
  if (!Array.isArray(record.sections)) return false;
  return record.sections.every(
    (section) => typeof section === 'string' && VALID_SECTIONS.has(section),
  );
}

/** Structural check for an outbound response from the content script. */
export function isExtractPageResponseSuccess(
  value: unknown,
): value is { ok: true; context: PageContext } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.ok === true && typeof record.context === 'object' && record.context !== null;
}
