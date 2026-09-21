import { PAGE_LIMITS } from './limits';
import { cleanText } from './sanitizer';

/**
 * Read the user's current text selection ON DEMAND (never monitored).
 * Sanitized and length-capped; null when nothing is selected.
 */
export function extractSelection(doc: Document): {
  text: string | null;
  truncated: boolean;
} {
  let raw: string | null = null;
  try {
    const selection = doc.defaultView?.getSelection();
    raw = selection && selection.rangeCount > 0 ? selection.toString() : null;
  } catch {
    raw = null;
  }

  if (raw === null) return { text: null, truncated: false };

  const capped = raw.slice(0, PAGE_LIMITS.MAX_SELECTED_TEXT);
  const truncated = raw.length > PAGE_LIMITS.MAX_SELECTED_TEXT;
  const cleaned = cleanText(capped, PAGE_LIMITS.MAX_SELECTED_TEXT);
  if (!cleaned) return { text: null, truncated: false };

  return { text: cleaned, truncated };
}
