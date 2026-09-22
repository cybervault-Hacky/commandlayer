/**
 * Lightweight content identity: 32-bit FNV-1a over a COMPACT digest of the
 * captured context (never over the full text), so future phases can cheaply
 * detect that a page's context changed between captures.
 */
import type { PageContext } from '@/shared/types/page';

export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function pageContentDigest(context: PageContext): string {
  const parts: string[] = [
    context.title ?? '',
    context.hostname ?? '',
    context.url ?? '',
    String(context.contentStats.textLength),
    String(context.headings.length),
    String(context.links.length),
    String(context.tables.length),
    String(context.forms.length),
    // Bounded fingerprints of leading content — not the full payload.
    context.paragraphs.slice(0, 5).join(' ').slice(0, 400),
    context.headings.slice(0, 10).map((h) => h.text).join(' ').slice(0, 300),
  ];
  return fnv1a32(parts.join('\u0001'));
}
