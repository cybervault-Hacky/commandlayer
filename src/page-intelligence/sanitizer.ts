/**
 * Extraction-time sanitization. Reuses the Phase 1 security utilities;
 * everything read from the DOM is untrusted input.
 */
import { displayHostname, sanitizeText } from '@/shared/security/sanitize';
import { parseSafeUrl } from '@/shared/security/url';
import { PAGE_LIMITS } from './limits';

/** Trim + normalize a text node chunk; null when nothing usable remains. */
export function cleanText(value: unknown, maxLength: number): string | null {
  return sanitizeText(value, maxLength);
}

/** Absolute, normalized http(s) URL or null. Rejects everything else. */
export function cleanUrl(value: unknown): {
  href: string;
  hostname: string;
} | null {
  const safe = parseSafeUrl(value);
  if (!safe) return null;
  return { href: safe.href, hostname: displayHostname(safe.hostname) };
}

/** BCP-47-ish language tag, or null. */
export function cleanLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > PAGE_LIMITS.MAX_LANGUAGE) {
    return null;
  }
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(trimmed)) return null;
  return trimmed;
}

/** Safe subset of HTML form methods. */
export function cleanMethod(value: unknown): string {
  if (typeof value !== 'string') return 'get';
  const m = value.trim().toLowerCase();
  return ['get', 'post', 'put', 'delete', 'patch'].includes(m) ? m : 'get';
}

/**
 * Normalize an input type to a safe structural label. Passwords are
 * reported as 'password' — their value is never read anywhere in this
 * codebase (enforced by the regression tests).
 */
export function cleanInputType(value: unknown): string {
  if (typeof value !== 'string') return 'text';
  const t = value.trim().toLowerCase();
  const SAFE_TYPES = [
    'text',
    'email',
    'number',
    'tel',
    'url',
    'search',
    'date',
    'time',
    'datetime-local',
    'month',
    'week',
    'password',
    'checkbox',
    'radio',
    'range',
    'color',
    'hidden',
  ];
  return SAFE_TYPES.includes(t) ? t : 'text';
}

/**
 * Element text content: normalize whitespace, strip control characters,
 * cap length. Returns '' for empty results.
 */
export function elementText(el: Element, maxLength: number): string {
  return sanitizeText(el.textContent, maxLength) ?? '';
}
