/**
 * Content-script foundation (Phase 1).
 *
 * This module is intentionally NOT registered in the Phase 1 manifest —
 * page intelligence is a later phase. It defines the stable contract those
 * phases will use to read page metadata from the active document:
 *
 *   1. A future phase registers this script (manifest `content_scripts`,
 *      or programmatic injection with `activeTab`).
 *   2. The background sends a typed message (e.g. cl:get-page-meta).
 *   3. This module replies with a sanitized PageContext via buildPageContext.
 *
 * Until then, current-page context is read from the tabs API in the
 * background, which keeps host permissions at zero.
 */
import { buildPageContext, type PageContextInput } from '@/shared/pageContext';
import type { PageContext } from '@/shared/types/page';

export interface ContentPageMeta extends PageContextInput {
  title: string;
  url: string;
}

/** Read metadata from a document without scraping its content. */
export function collectPageMeta(doc: Document): ContentPageMeta {
  let title = '';
  let url = '';
  try {
    title = doc.title ?? '';
    url = doc.location?.href ?? '';
  } catch {
    // Security-sensitive documents can throw on access; degrade safely.
  }
  return { title, url };
}

/** Build a sanitized PageContext for the current document. */
export function buildPageMetaContext(doc: Document): PageContext {
  return buildPageContext(collectPageMeta(doc));
}
