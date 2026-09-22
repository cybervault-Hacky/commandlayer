/**
 * PageContext — the structured representation of the user's current webpage.
 *
 * Two tiers share one model:
 * - BASIC: state + title/url/hostname (read from the tabs API; always cheap)
 * - INTELLIGENCE: the same model enriched by the content-script extractor
 *   (headings, paragraphs, links, tables, forms, selected text, stats)
 *
 * Privacy invariants (enforced by the extractor AND by the validator that
 * parses content-script responses):
 * - input VALUES are never collected — only structural field metadata
 * - passwords, tokens, cookies, storage, and history are never inspected
 * - every string is sanitized and every collection is capped
 */

export type PageContextState =
  | 'not-requested' // intelligence requested nothing yet (UI initial state)
  | 'requesting' // capture in flight (UI state; not produced by extractors)
  | 'ready' // full context captured
  | 'partial' // captured, but some sections were truncated by limits
  | 'unsupported' // browser-internal page (chrome://, edge://, about:, ...)
  | 'unavailable' // no tab, no data, or content script not present
  | 'permission-required'; // host permission missing / script blocked

export type PageContextReason =
  | 'browser-page'
  | 'no-tab'
  | 'no-content-script'
  | 'permission'
  | 'error';

/** Which sections a capture request asks for (on-demand, no over-collection). */
export const PageSection = {
  Metadata: 'metadata',
  Headings: 'headings',
  Text: 'text',
  Links: 'links',
  Tables: 'tables',
  Forms: 'forms',
  Selection: 'selection',
} as const;

export type PageSection = (typeof PageSection)[keyof typeof PageSection];

/** Coarse capture profiles used by commands and quick actions. */
export const PageContextProfile = {
  Full: 'full',
  Content: 'content',
  Metadata: 'metadata',
} as const;

export type PageContextProfile =
  (typeof PageContextProfile)[keyof typeof PageContextProfile];

export interface PageHeading {
  level: 1 | 2 | 3 | 4;
  text: string;
}

export interface PageLink {
  text: string;
  url: string;
  hostname: string;
  rel?: string;
}

export interface PageTable {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

/** Structural form metadata ONLY — input values are never collected. */
export interface PageFormField {
  name?: string;
  /** Normalized input type (e.g. 'password' — without its value). */
  type: string;
  label?: string;
  required: boolean;
}

export interface PageForm {
  action?: string;
  method: string;
  fields: PageFormField[];
  truncated: boolean;
}

export interface PageContentStats {
  textLength: number;
  wordCount: number;
  paragraphCount: number;
  headingCount: number;
  linkCount: number;
  tableCount: number;
  formCount: number;
  selectedTextLength: number;
}

export interface PageContext {
  state: PageContextState;
  reason?: PageContextReason;

  /* --- metadata (basic + intelligence) --- */
  title?: string;
  url?: string;
  hostname?: string;
  description?: string;
  language?: string;
  canonicalUrl?: string;

  /* --- intelligence (empty when not captured) --- */
  headings: PageHeading[];
  /** Extracted visible main text, normalized (paragraphs/list items). */
  paragraphs: string[];
  links: PageLink[];
  selectedText: string | null;
  tables: PageTable[];
  forms: PageForm[];
  contentStats: PageContentStats;
  /** True when any section hit an extraction limit. */
  truncated: boolean;
  /** Lightweight identity (FNV-1a 32-bit hex) for change detection. */
  contentHash?: string;

  capturedAt: string;
}

/** A basic (tabs-API-only) context with empty intelligence sections. */
export function createEmptyPageContext(): Pick<
  PageContext,
  | 'headings'
  | 'paragraphs'
  | 'links'
  | 'selectedText'
  | 'tables'
  | 'forms'
  | 'contentStats'
  | 'truncated'
> {
  return {
    headings: [],
    paragraphs: [],
    links: [],
    selectedText: null,
    tables: [],
    forms: [],
    contentStats: {
      textLength: 0,
      wordCount: 0,
      paragraphCount: 0,
      headingCount: 0,
      linkCount: 0,
      tableCount: 0,
      formCount: 0,
      selectedTextLength: 0,
    },
    truncated: false,
  };
}
