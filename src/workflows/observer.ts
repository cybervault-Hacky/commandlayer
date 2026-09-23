/**
 * Phase 5 — bounded context observation.
 *
 * Observation happens ONLY at defined checkpoints:
 *
 *   before step · after a mutating step · on verification failure
 *
 * There is no polling, no MutationObserver, no timer, and no background
 * surveillance: the orchestrator asks for exactly one snapshot when it
 * reaches a checkpoint, and the run-level budget
 * (WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES) bounds how many snapshots a
 * workflow may ever take.
 *
 * Observations reuse Phase 2 Page Intelligence (`getPageContext`) — there
 * is no second page scraper. Only the minimum context is collected: the
 * capture uses the same section profile as the Phase 4 freshness check
 * (`metadata`, `headings`, `text`), so the digest produced here is
 * directly comparable with the one the executor re-captures. Form fields,
 * typed values, links, tables, and selections are never captured during a
 * run, and nothing is stored beyond the bounded sample below.
 */
import { pageContentDigest } from '@/page-intelligence/hash';
import { parseSafeUrl } from '@/shared/security/url';
import type { PageContext, PageSection } from '@/shared/types/page';
import { WORKFLOW_LIMITS } from './limits';

/** A single bounded observation. Never contains form values or secrets. */
export interface ObservationSample {
  url: string;
  /** The same digest the Phase 4 executor re-captures for freshness. */
  contentHash: string;
  title?: string;
  /** Bounded heading sample for verification/display (≤ 8 entries). */
  headings: string[];
}

/** The privileged capture seam (injected; the background wires Phase 2 in). */
export type ObservationSource = (options: {
  sections: readonly PageSection[];
}) => Promise<PageContext | null>;

/**
 * One-shot observer. `observe()` performs the single allowed capture and
 * converts it into a bounded sample, or returns null when the page could
 * not be observed (no tab, restricted site, extraction failure).
 */
export class WorkflowObserver {
  constructor(private readonly source: ObservationSource) {}

  async observe(): Promise<ObservationSample | null> {
    let context: PageContext | null;
    try {
      context = await this.source({
        sections: WORKFLOW_LIMITS.OBSERVATION_SECTIONS,
      });
    } catch {
      return null;
    }
    if (context === null) return null;
    if (context.state !== 'ready' && context.state !== 'partial') return null;

    const safeUrl = parseSafeUrl(context.url);
    const headings = context.headings
      .slice(0, WORKFLOW_LIMITS.OBSERVATION_MAX_HEADINGS)
      .map((heading) => heading.text);

    return {
      url: safeUrl?.href ?? '',
      contentHash: pageContentDigest(context),
      ...(context.title ? { title: context.title } : {}),
      headings,
    };
  }
}

/** True when the observed URL differs from the URL the run was bound to. */
export function detectNavigation(
  previousUrl: string,
  observedUrl: string,
): boolean {
  if (observedUrl.length === 0) return false;
  if (previousUrl.length === 0) return true;
  return normalizeUrl(previousUrl) !== normalizeUrl(observedUrl);
}

/**
 * Does the observed URL satisfy an expected destination? Comparison is on
 * origin + path (query strings and fragments are ignored) so tracking
 * parameters never turn a successful navigation into a failure.
 */
export function urlMatchesExpectation(
  observedUrl: string,
  expectedUrl: string,
): boolean {
  const observed = parseSafeUrl(observedUrl);
  const expected = parseSafeUrl(expectedUrl);
  if (!observed || !expected) return false;
  return (
    observed.origin === expected.origin &&
    trimPath(observed.href) === trimPath(expected.href)
  );
}

/** True when the observed content digest differs from the previous one. */
export function observedContentChanged(
  previousHash: string,
  observedHash: string,
): boolean {
  if (observedHash.length === 0) return false;
  if (previousHash.length === 0) return true;
  return previousHash !== observedHash;
}

/** Compare the meaningful part of a URL: origin + path, no query/hash. */
function trimPath(href: string): string {
  const withoutHash = href.split('#')[0] ?? href;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  return withoutQuery.endsWith('/')
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

function normalizeUrl(value: string): string {
  const safe = parseSafeUrl(value);
  return safe ? trimPath(safe.href) : value.trim();
}
