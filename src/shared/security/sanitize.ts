/**
 * Text sanitization for any value that crosses into the UI (page titles,
 * hostnames, ...). Strips control characters, collapses whitespace, and
 * truncates with an ellipsis.
 */
// Intentional: stripping control characters is the purpose of this helper.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F\u2028\u2029]/g;
const LINE_BREAKS = /[\t\r\n\u2028\u2029]/g;

export function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  if (!Number.isFinite(maxLength) || maxLength <= 0) return null;

  // Line breaks become single spaces (preserving word separation); the
  // remaining control characters are dropped entirely.
  const cleaned = value
    .replace(LINE_BREAKS, ' ')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return null;
  if (cleaned.length > maxLength) {
    return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return cleaned;
}

/** Display form of a hostname: lowercase, no port, no leading www. */
export function displayHostname(hostname: string): string {
  const withoutPort = hostname.split(':')[0] ?? hostname;
  return withoutPort.toLowerCase().replace(/^www\./, '');
}
