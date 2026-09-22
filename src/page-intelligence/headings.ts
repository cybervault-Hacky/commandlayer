import type { PageHeading } from '@/shared/types/page';
import { PAGE_LIMITS } from './limits';
import { elementText } from './sanitizer';
import { isElementVisible } from './visibility';

const HEADING_SELECTOR = 'h1, h2, h3, h4';

/**
 * Extract meaningful headings (H1–H4) in document order, preserving level.
 * Empty/whitespace-only and hidden headings are ignored; output is capped.
 */
export function extractHeadings(doc: Document): {
  headings: PageHeading[];
  truncated: boolean;
} {
  const headings: PageHeading[] = [];
  let truncated = false;

  const nodes = doc.querySelectorAll(HEADING_SELECTOR);
  for (const node of Array.from(nodes)) {
    if (headings.length >= PAGE_LIMITS.MAX_HEADINGS) {
      truncated = true;
      break;
    }
    if (!isElementVisible(node)) continue;

    const text = elementText(node, PAGE_LIMITS.MAX_HEADING_LENGTH);
    if (text.length === 0) continue;

    const tag = node.tagName.toLowerCase();
    const level = (parseInt(tag.slice(1), 10) ?? 1) as PageHeading['level'];
    headings.push({ level, text });
  }

  return { headings, truncated };
}
