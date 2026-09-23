import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import { detectGitHub } from '@/github/detect';
import { GitHubSurface, type GitHubPageContext } from '@/github/types';
import { sectionsForIntent } from '@/page-intelligence/profiles';
import { DeveloperIntent } from '@/developer/intents';
import type { PageSection } from '@/shared/types/page';

export interface UseDeveloperContextResult {
  /** The validated GitHub context of the current page, when there is one. */
  github: GitHubPageContext | null;
  /** True when the active URL is a GitHub page (detected from the URL). */
  isGitHubPage: boolean;
  loading: boolean;
  /** Debounced re-capture (safe to call from focus/visibility events). */
  refresh: () => void;
}

/** One bounded capture, tagged with the URL it belongs to. */
interface DeveloperCapture {
  /** The URL this capture belongs to (null = nothing captured yet). */
  url: string | null;
  github: GitHubPageContext | null;
}

const NO_CAPTURE: DeveloperCapture = { url: null, github: null };

/**
 * Phase 7 — the Developer Mode context.
 *
 * URL-first: the active URL decides whether this is a GitHub page at all, so
 * a non-GitHub page never triggers a capture. On a GitHub page exactly ONE
 * bounded capture is requested (structure + text + links + the typed GitHub
 * context), and it is reused until the URL changes.
 *
 * All state is written after an await inside a cancelled-guarded task, so the
 * component never renders from a stale capture, a late response can never
 * overwrite a newer page, and nothing mutates anything.
 */
export function useDeveloperContext(
  enabled: boolean,
  pageUrl: string | undefined,
): UseDeveloperContextResult {
  const [capture, setCapture] = useState<DeveloperCapture>(NO_CAPTURE);
  const timerRef = useRef<number | null>(null);

  // Opt-in: without Developer Mode (or off GitHub) this hook performs NO
  // capture at all — the Phase 2 on-demand capture guarantee is preserved.
  const isGitHubPage =
    enabled && pageUrl !== undefined && detectGitHub(pageUrl).isGitHub;

  /** One bounded capture for one URL. Never asks for more than the profile. */
  const captureFor = useCallback(async (): Promise<GitHubPageContext | null> => {
    const sections = [
      ...sectionsForIntent(DeveloperIntent.ExplainRepository),
    ] as PageSection[];
    const result = await sendMessage(MessageType.GET_PAGE_CONTEXT, { sections });
    // A development preview (no real extension host) legitimately has no
    // GitHub context: that is a state, not an error.
    return result.ok ? (result.data.github ?? null) : null;
  }, []);

  /** True when this URL has already been captured (or attempted). */
  const settled = capture.url === pageUrl;

  useEffect(() => {
    if (!isGitHubPage || pageUrl === undefined || settled) return;
    let cancelled = false;
    void (async () => {
      let github: GitHubPageContext | null = null;
      try {
        github = await captureFor();
      } catch {
        github = null;
      }
      // Stale-request protection: a superseded capture never lands.
      if (cancelled) return;
      setCapture({ url: pageUrl, github });
    })();
    return () => {
      cancelled = true;
    };
  }, [isGitHubPage, pageUrl, settled, captureFor]);

  const refresh = useCallback(() => {
    if (!isGitHubPage) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      // Invalidate the capture for this URL; the effect re-runs exactly once.
      setCapture((prev) => ({ ...prev, url: null }));
    }, 250);
  }, [isGitHubPage]);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return {
    // Off GitHub (or with Developer Mode off) this is always null, even if a
    // capture from a previous page is still in state.
    github: isGitHubPage ? capture.github : null,
    isGitHubPage,
    loading: isGitHubPage && !settled,
    refresh,
  };
}

/** True when the captured context has enough structure to be worth showing. */
export function hasDeveloperStructure(github: GitHubPageContext | null): boolean {
  if (github === null) return false;
  return github.surface !== GitHubSurface.Unknown;
}
