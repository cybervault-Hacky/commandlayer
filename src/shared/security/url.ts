import { PAGE_CONTEXT_URL_MAX } from '../constants/app';

/**
 * Safe URL parsing. Only http/https URLs are ever accepted; everything else
 * (javascript:, data:, vbscript:, file:, opaque origins, ...) is rejected.
 * Never use the raw value without going through these helpers.
 */
export interface SafeUrl {
  href: string;
  hostname: string;
  protocol: string;
  origin: string;
}

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function parseSafeUrl(input: unknown): SafeUrl | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > PAGE_CONTEXT_URL_MAX) return null;

  let url: URL;
  try {
    // Resolve against a neutral base so relative strings do not throw,
    // then enforce the protocol allowlist on the result.
    url = new URL(trimmed, 'https://commandlayer.invalid/');
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.hostname.length === 0) return null;

  return {
    href: url.href,
    hostname: url.hostname.toLowerCase(),
    protocol: url.protocol,
    origin: url.origin,
  };
}

/**
 * True when the value is a recognizable URL with a protocol we do not support
 * (e.g. chrome://, edge://, about:, view-source:). Used to distinguish
 * "unsupported page" from "no data".
 */
export function isUnsupportedPageUrl(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  try {
    const url = new URL(trimmed);
    return !ALLOWED_PROTOCOLS.has(url.protocol);
  } catch {
    return true;
  }
}
