import { PAGE_LIMITS } from './limits';
import { elementText } from './sanitizer';
import { isElementVisible } from './visibility';

/**
 * Lightweight readable-text extraction (deterministic baseline, not a
 * reader-mode algorithm).
 *
 * - Prefers an article/main root when present, otherwise the document body
 * - Takes only meaningful blocks: p, li, blockquote, figcaption, dd, dt
 * - Excludes navigation, headers, footers, asides, forms, search and
 *   boilerplate roles where identifiable
 * - Skips hidden elements, normalizes whitespace, de-duplicates
 * - Enforces per-paragraph and total-character limits
 */

const PARAGRAPH_SELECTOR = 'p, li, blockquote, figcaption, dd, dt';
const EXCLUDED_ANCESTORS =
  'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"]';

function findContentRoot(doc: Document): Element | null {
  return (
    doc.querySelector('article') ??
    doc.querySelector('main') ??
    doc.querySelector('[role="main"]') ??
    doc.body
  );
}

export function extractParagraphs(doc: Document): {
  paragraphs: string[];
  textLength: number;
  wordCount: number;
  truncated: boolean;
} {
  const root = findContentRoot(doc);
  const paragraphs: string[] = [];
  const seen = new Set<string>();
  let textLength = 0;
  let truncated = false;

  if (root) {
    const nodes = root.querySelectorAll(PARAGRAPH_SELECTOR);
    for (const node of Array.from(nodes)) {
      if (paragraphs.length >= PAGE_LIMITS.MAX_PARAGRAPHS) {
        truncated = true;
        break;
      }
      if (node.closest(EXCLUDED_ANCESTORS)) continue;
      if (!isElementVisible(node)) continue;

      const text = elementText(node, PAGE_LIMITS.MAX_PARAGRAPH_LENGTH);
      if (text.length === 0) continue;
      if (seen.has(text)) continue;

      if (textLength + text.length > PAGE_LIMITS.MAX_TEXT_CHARACTERS) {
        truncated = true;
        break;
      }
      seen.add(text);

      paragraphs.push(text);
      textLength += text.length;
    }
  }

  let wordCount = 0;
  for (const paragraph of paragraphs) {
    wordCount += paragraph.split(/\s+/).filter(Boolean).length;
  }

  return { paragraphs, textLength, wordCount, truncated };
}
