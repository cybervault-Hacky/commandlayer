import type { PageLink } from '@/shared/types/page';
import { PAGE_LIMITS } from './limits';
import { cleanText, cleanUrl } from './sanitizer';
import { isElementVisible } from './visibility';

const REL_TOKENS = new Set([
  'nofollow',
  'sponsored',
  'external',
  'noopener',
  'noreferrer',
  'ugc',
  'me',
  'author',
  'license',
]);

/**
 * Extract meaningful links: visible anchors with resolvable http(s) URLs,
 * normalized to absolute form, de-duplicated by URL, capped in count.
 * No crawling — only the current page.
 */
export function extractLinks(doc: Document): {
  links: PageLink[];
  truncated: boolean;
} {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const anchors = doc.querySelectorAll('a[href]');
  for (const anchor of Array.from(anchors)) {
    if (links.length >= PAGE_LIMITS.MAX_LINKS) {
      truncated = true;
      break;
    }
    if (!isElementVisible(anchor)) continue;

    const rawHref = (anchor.getAttribute('href') ?? '').trim();
    if (rawHref.length === 0 || rawHref.startsWith('#')) continue;
    let absolute: string;
    try {
      absolute = new URL(rawHref, doc.location?.href ?? undefined)?.href ?? '';
    } catch {
      continue;
    }
    const url = cleanUrl(absolute);
    if (!url) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);

    const relRaw = anchor.getAttribute('rel');
    const rel = relRaw
      ? relRaw
          .split(/\s+/)
          .map((t) => t.toLowerCase())
          .filter((t) => REL_TOKENS.has(t))
          .slice(0, 3)
          .join(' ')
      : undefined;

    links.push({
      text: cleanText(anchor.textContent, PAGE_LIMITS.MAX_LINK_TEXT_LENGTH) ?? '',
      url: url.href,
      hostname: url.hostname,
      ...(rel ? { rel } : {}),
    });
  }

  return { links, truncated };
}
