/**
 * Visibility detection without forcing layout on every DOM node.
 *
 * Strategy (cheap first, expensive never repeated):
 * 1. Structural exclusion: ancestors that are non-rendered by definition
 *    (script, style, template, ...) are skipped as whole subtrees.
 * 2. Cheap attributes: `hidden`, `aria-hidden="true"`, zero-length computed
 *    display/visibility checks.
 * 3. getComputedStyle is consulted only on CANDIDATE content elements (the
 *    capped set we actually extract), never on the full node set.
 */

const NON_RENDERED_ANCESTORS =
  'script,style,noscript,template,svg,canvas,iframe,frame,object,embed,video,audio,map';

/**
 * Layout-metrics availability, probed once per document from <body>.
 *
 * Real browsers report real offsetWidth values; layout-less environments
 * (jsdom) report 0 for EVERY element, which would wrongly hide all content.
 * When the probe finds no layout, the zero-size check is skipped — the
 * remaining visibility signals (display, visibility, hidden, aria-hidden,
 * non-rendered ancestors) still apply.
 */
const layoutProbeCache = new WeakMap<Document, boolean>();

function layoutMetricsAvailable(doc: Document): boolean {
  const cached = layoutProbeCache.get(doc);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    const body = doc.body;
    available =
      !!body && typeof body.offsetWidth === 'number' && body.offsetWidth > 0;
  } catch {
    available = false;
  }
  layoutProbeCache.set(doc, available);
  return available;
}

/** True when the element lives inside a subtree that is never rendered. */
export function isInsideNonRenderedElement(el: Element): boolean {
  return !!el.closest(NON_RENDERED_ANCESTORS);
}

/**
 * Visible enough to count as page content. `getComputedStyle` may force a
 * style recalculation, so callers should invoke this only on the capped
 * candidate set — never on `document.querySelectorAll('*')`.
 */
export function isElementVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (htmlEl.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (isInsideNonRenderedElement(el)) return false;

  let style: CSSStyleDeclaration | undefined;
  try {
    style = el.ownerDocument.defaultView?.getComputedStyle(el);
  } catch {
    // Detached or exotic document — treat as visible and let the text
    // content (likely empty) fall out naturally.
    return true;
  }
  if (!style) return true;

  const display = style.display;
  const visibility = style.visibility;
  const contentVisibility =
    (style as CSSStyleDeclaration & { contentVisibility?: string })
      .contentVisibility;

  if (display === 'none') return false;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  if (contentVisibility === 'hidden' || contentVisibility === 'none') {
    return false;
  }

  // Zero-size check: only meaningful where layout exists (see probe above).
  if (layoutMetricsAvailable(el.ownerDocument)) {
    const width = (el as HTMLElement).offsetWidth;
    const height = (el as HTMLElement).offsetHeight;
    if (typeof width === 'number' && width === 0 && height === 0) {
      return false;
    }
  }

  return true;
}

/** Elements where text extraction should not descend (nav, footer, ...). */
export function isExcludedContentElement(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role === 'navigation' || role === 'none' || role === 'presentation') {
    return true;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'nav' || tag === 'form') return true;
  return false;
}
