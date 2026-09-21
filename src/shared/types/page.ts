/**
 * Current-page context as collected for Phase 1.
 *
 * Deliberately minimal: title, URL, display hostname and an availability
 * state. No scraping, no history, no stored browsing data.
 */
export type PageContextState = 'ready' | 'unsupported' | 'unavailable';

export interface PageContext {
  state: PageContextState;
  title?: string;
  url?: string;
  hostname?: string;
  /** Why the context is not ready, when it is not. */
  reason?: 'browser-page' | 'no-tab' | 'error';
  fetchedAt: string;
}
