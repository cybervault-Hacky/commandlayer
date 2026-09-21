import {
  PageSection,
  createEmptyPageContext,
  type PageContext,
  type PageSection as Section,
} from '@/shared/types/page';

import { extractForms } from './forms';
import { pageContentDigest } from './hash';
import { extractHeadings } from './headings';
import { extractLinks } from './links';
import { extractMetadata } from './metadata';
import { extractParagraphs } from './text';
import { extractTables } from './tables';
import { extractSelection } from './selection';

export interface ExtractOptions {
  /** Which sections to extract (on-demand; null/empty = everything). */
  sections?: readonly Section[] | null;
}

/**
 * Page Intelligence Engine — single deterministic extraction pass.
 *
 * One request → one controlled walk of the DOM → one sanitized PageContext.
 * No observers, no polling, no network, no retries. Every section is capped
 * by PAGE_LIMITS; any cap hit sets `truncated: true` and state `partial`.
 */
export function extractPageContext(
  doc: Document,
  options: ExtractOptions = {},
): PageContext {
  const wanted = new Set<Section>(
    options.sections && options.sections.length > 0
      ? options.sections
      : Object.values(PageSection),
  );
  const capturedAt = new Date().toISOString();

  const context: PageContext = {
    state: 'ready',
    selectedText: null,
    headings: [],
    paragraphs: [],
    links: [],
    tables: [],
    forms: [],
    contentStats: createEmptyPageContext().contentStats,
    truncated: false,
    capturedAt,
  };

  let truncated = false;

  if (wanted.has(PageSection.Metadata)) {
    Object.assign(context, extractMetadata(doc));
  }

  if (wanted.has(PageSection.Headings)) {
    const { headings, truncated: t } = extractHeadings(doc);
    context.headings = headings;
    truncated = truncated || t;
  }

  if (wanted.has(PageSection.Text)) {
    const { paragraphs, textLength, wordCount, truncated: t } =
      extractParagraphs(doc);
    context.paragraphs = paragraphs;
    context.contentStats.textLength = textLength;
    context.contentStats.wordCount = wordCount;
    truncated = truncated || t;
  }

  if (wanted.has(PageSection.Links)) {
    const { links, truncated: t } = extractLinks(doc);
    context.links = links;
    truncated = truncated || t;
  }

  if (wanted.has(PageSection.Tables)) {
    const { tables, truncated: t } = extractTables(doc);
    context.tables = tables;
    truncated = truncated || t;
  }

  if (wanted.has(PageSection.Forms)) {
    const { forms, truncated: t } = extractForms(doc);
    context.forms = forms;
    truncated = truncated || t;
  }

  if (wanted.has(PageSection.Selection)) {
    const { text, truncated: t } = extractSelection(doc);
    context.selectedText = text;
    context.contentStats.selectedTextLength = text?.length ?? 0;
    truncated = truncated || t;
  }

  context.contentStats.paragraphCount = context.paragraphs.length;
  context.contentStats.headingCount = context.headings.length;
  context.contentStats.linkCount = context.links.length;
  context.contentStats.tableCount = context.tables.length;
  context.contentStats.formCount = context.forms.length;

  context.truncated = truncated;
  context.contentHash = pageContentDigest(context);
  context.state = truncated ? 'partial' : 'ready';

  return context;
}
