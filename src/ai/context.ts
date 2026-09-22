/**
 * Phase 3 — context builder: PageContext → explicit, minimal AIContext.
 *
 * Privacy / minimization invariants:
 * - every intent receives ONLY the sections it needs (per-intent budget)
 * - forms (even structural metadata) are NEVER sent to the AI
 * - all text is re-sanitized and truncated to AI_LIMITS budgets
 * - the returned object is a closed shape: no unused fields, no
 *   duplicates (headings/links deduped), no raw DOM references
 */
import { sanitizeText } from '@/shared/security/sanitize';
import type { PageContext } from '@/shared/types/page';
import { AI_LIMITS } from './limits';
import { AIIntent, type AIContext } from './types';

/**
 * Which PageContext sections each reasoning intent needs.
 * (forms is intentionally absent from every intent.)
 */
export const INTENT_CONTEXT_SECTIONS: Record<
  AIIntent,
  {
    headings: boolean;
    text: boolean;
    links: boolean;
    tables: boolean;
    selectedText: boolean;
  }
> = {
  [AIIntent.Summarize]: {
    headings: true,
    text: true,
    links: false,
    tables: false,
    selectedText: false,
  },
  [AIIntent.Explain]: {
    headings: true,
    text: true,
    links: false,
    tables: false,
    selectedText: false,
  },
  [AIIntent.Analyze]: {
    headings: true,
    text: true,
    links: true,
    tables: true,
    selectedText: false,
  },
  [AIIntent.Extract]: {
    headings: true,
    text: true,
    links: false,
    tables: false,
    selectedText: false,
  },
  [AIIntent.Answer]: {
    headings: true,
    text: true,
    links: true,
    tables: false,
    selectedText: true,
  },
};

/**
 * Build the minimal AIContext for an intent from a captured PageContext.
 * Returns null when the page cannot be reasoned about (unsupported,
 * unavailable, or no captured content at all).
 */
export function buildAIContext(
  page: PageContext,
  intent: AIIntent,
): AIContext | null {
  if (page.state !== 'ready' && page.state !== 'partial') return null;
  if (!page.url) return null;

  const need = INTENT_CONTEXT_SECTIONS[intent];
  let truncated = page.truncated;

  const pageMeta: AIContext['page'] = {
    title: sanitizeText(page.title, AI_LIMITS.MAX_SOURCE_TITLE) ?? undefined,
    url: sanitizeText(page.url, 2048) ?? undefined,
    hostname: sanitizeText(page.hostname, 253) ?? undefined,
    language: sanitizeText(page.language, 16) ?? undefined,
    description:
      sanitizeText(page.description, AI_LIMITS.MAX_SOURCE_TITLE) ?? undefined,
  };

  const headings = need.headings
    ? page.headings
        .slice(0, AI_LIMITS.MAX_CONTEXT_HEADINGS)
        .map((h) => ({
          level: h.level,
          text: sanitizeText(h.text, 160) ?? '',
        }))
        .filter((h) => h.text.length > 0)
    : [];
  if (need.headings && page.headings.length > headings.length) {
    truncated = true;
  }

  const text = need.text
    ? joinText(page.paragraphs, AI_LIMITS.MAX_CONTEXT_TEXT_CHARS)
    : { value: '', wasTruncated: false };

  const links = need.links
    ? dedupe(
        page.links
          .slice(0, AI_LIMITS.MAX_CONTEXT_LINKS)
          .map((l) => ({
            text: sanitizeText(l.text, 120) ?? '',
            url: sanitizeText(l.url, 2048) ?? '',
            hostname: sanitizeText(l.hostname, 253) ?? '',
          }))
          .filter((l) => l.url.length > 0),
        (l) => l.url,
      )
    : [];
  if (need.links && page.links.length > links.length) truncated = true;

  const tables = need.tables
    ? page.tables.slice(0, AI_LIMITS.MAX_CONTEXT_TABLES).map((t) => {
        const rows = t.rows.slice(0, AI_LIMITS.MAX_CONTEXT_TABLE_ROWS);
        return {
          headers: t.headers
            .slice(0, 12)
            .map((h) => sanitizeText(h, 200) ?? ''),
          rows: rows.map((r) =>
            r.slice(0, 12).map((c) => sanitizeText(c, 200) ?? ''),
          ),
        };
      })
    : [];
  if (need.tables && page.tables.length > tables.length) truncated = true;

  const selectedText = need.selectedText && page.selectedText
    ? (sanitizeText(page.selectedText, AI_LIMITS.MAX_CONTEXT_SELECTED) ?? null)
    : null;
  if (
    need.selectedText &&
    page.selectedText &&
    page.selectedText.length > AI_LIMITS.MAX_CONTEXT_SELECTED
  ) {
    truncated = true;
  }

  // The page must have SOMETHING to reason about beyond bare metadata.
  const hasContent =
    headings.length > 0 || text.value.length > 0 || links.length > 0;
  if (!hasContent) return null;

  return {
    page: pageMeta,
    headings,
    text: text.value,
    links,
    tables,
    selectedText,
    truncated: truncated || text.wasTruncated,
  };
}

function joinText(
  paragraphs: string[],
  maxChars: number,
): { value: string; wasTruncated: boolean } {
  if (paragraphs.length === 0) return { value: '', wasTruncated: false };
  const full = paragraphs
    .map((p) => sanitizeText(p, 600) ?? '')
    .filter((p) => p.length > 0)
    .join('\n\n');
  if (full.length <= maxChars) return { value: full, wasTruncated: false };
  return { value: full.slice(0, maxChars), wasTruncated: true };
}

function dedupe<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
