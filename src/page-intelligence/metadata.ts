import { PAGE_LIMITS } from './limits';
import {
  cleanLanguage,
  cleanText,
  cleanUrl,
} from './sanitizer';

/**
 * Page metadata: title, URL, description, language, canonical URL.
 * Every value is sanitized; unknown/garbage values become undefined.
 */
export interface PageMetadata {
  title?: string;
  url?: string;
  hostname?: string;
  description?: string;
  language?: string;
  canonicalUrl?: string;
}

function metaContent(doc: Document, names: readonly string[]): string | null {
  for (const name of names) {
    const el =
      doc.querySelector(`meta[name="${name}"][content]`) ??
      doc.querySelector(`meta[property="${name}"][content]`);
    const content = cleanText(el?.getAttribute('content') ?? '', PAGE_LIMITS.MAX_DESCRIPTION);
    if (content) return content;
  }
  return null;
}

export function extractMetadata(doc: Document): PageMetadata {
  const url = cleanUrl(doc.location?.href ?? '');
  const canonicalEl = doc.querySelector<HTMLBaseElement>(
    'link[rel="canonical"][href]',
  );
  let canonical: { href: string; hostname: string } | null = null;
  if (canonicalEl) {
    // Resolve relative canonical URLs against the page URL, not a neutral base.
    try {
      const absolute = new URL(
        canonicalEl.getAttribute('href') ?? '',
        doc.location?.href ?? undefined,
      ).href;
      canonical = cleanUrl(absolute);
    } catch {
      canonical = null;
    }
  }

  return {
    title: cleanText(doc.title, PAGE_LIMITS.MAX_TITLE) ?? undefined,
    url: url?.href,
    hostname: url?.hostname,
    description: metaContent(doc, ['description', 'og:description']) ?? undefined,
    language:
      cleanLanguage(
        doc.documentElement.getAttribute('lang') ??
          metaContent(doc, ['language']) ??
          undefined,
      ) ?? undefined,
    canonicalUrl: canonical?.href,
  };
}
