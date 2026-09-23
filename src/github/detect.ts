/**
 * Phase 7 — GitHub surface detection.
 *
 * Detection is URL-first on purpose: the URL is deterministic, testable, and
 * unaffected by GitHub's markup churn. Reserved routes (`/settings`,
 * `/marketplace`, …) are never treated as owners, unknown routes are reported
 * as `unknown` rather than guessed, and every part is validated with the
 * shared patterns before it enters a context.
 *
 * The only ambiguity the URL cannot resolve is where a branch ends and a path
 * begins in `/tree/<ref>/<path>` or `/blob/<ref>/<path>` (branch names may
 * contain slashes). The detector takes the first segment as the ref and
 * reports the rest as the path; `parseGitHubContext` then corroborates and
 * corrects that against the rendered page when the page states its ref.
 */
import {
  GITHUB_CODE_PATH,
  isReservedOwner,
  isSafeCommitSha,
  isSafeOwner,
  isSafeRepoPath,
  isSafeRepository,
  isSafeTag,
  sanitizeSearchQuery,
} from './patterns';
import { GITHUB_LIMITS } from './limits';
import { GitHubSurface, type GitHubSurface as Surface } from './types';

export interface GitHubDetection {
  isGitHub: boolean;
  surface: Surface;
  owner: string | null;
  repository: string | null;
  branch: string | null;
  path: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  issueNumber: number | null;
  discussionNumber: number | null;
  releaseTag: string | null;
  searchQuery: string | null;
}

const NO_DETECTION: GitHubDetection = {
  isGitHub: false,
  surface: GitHubSurface.Unknown,
  owner: null,
  repository: null,
  branch: null,
  path: null,
  commitSha: null,
  pullRequestNumber: null,
  issueNumber: null,
  discussionNumber: null,
  releaseTag: null,
  searchQuery: null,
};

/** Repository sub-routes that do not map to one of the supported surfaces. */
const UNSUPPORTED_REPO_ROUTES: ReadonlySet<string> = new Set([
  'actions',
  'branches',
  'compare',
  'deployments',
  'forks',
  'graphs',
  'issues',
  'labels',
  'milestones',
  'network',
  'packages',
  'projects',
  'pulse',
  'security',
  'settings',
  'stargazers',
  'tags',
  'watchers',
  'wiki',
]);

function positiveInt(value: string | undefined): number | null {
  if (!value || !/^\d{1,7}$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Detect the GitHub surface and identity from a URL. Pure and total: a URL
 * that cannot be understood produces an `unknown` (never a guess).
 */
export function detectGitHub(url: string | undefined | null): GitHubDetection {
  if (!url) return NO_DETECTION;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NO_DETECTION;
  }
  if (
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'http:'
  ) {
    return NO_DETECTION;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return NO_DETECTION;

  const segments = parsed.pathname.split('/').filter(Boolean).map(decodeSegment);
  const first = segments[0];
  if (first === undefined) {
    return { ...NO_DETECTION, isGitHub: true };
  }

  // Global routes (github.com/search, /notifications, /settings, …).
  if (isReservedOwner(first) || first === 'search') {
    if (first === 'search') {
      return {
        ...NO_DETECTION,
        isGitHub: true,
        surface: GitHubSurface.Search,
        searchQuery: sanitizeSearchQuery(parsed.searchParams.get('q') ?? ''),
      };
    }
    return { ...NO_DETECTION, isGitHub: true };
  }

  const owner = isSafeOwner(first) ? first : null;
  const repository = isSafeRepository(segments[1]) ? segments[1] : null;
  if (!owner || !repository) {
    // A profile page (github.com/<user>) is a valid GitHub page, but not one
    // of the supported surfaces.
    return { ...NO_DETECTION, isGitHub: true, owner };
  }

  const base: GitHubDetection = {
    ...NO_DETECTION,
    isGitHub: true,
    owner,
    repository,
  };

  const route = segments[2];
  const rest = segments.slice(3);

  if (route === undefined) {
    return { ...base, surface: GitHubSurface.Repository };
  }

  switch (route) {
    case 'tree':
    case 'blob': {
      const ref = rest[0] !== undefined && rest[0].length <= GITHUB_LIMITS.MAX_REF_LENGTH ? rest[0] : null;
      const pathSegments = rest.slice(1);
      const path =
        pathSegments.length > 0 && isSafeRepoPath(pathSegments.join('/'))
          ? pathSegments.join('/')
          : null;
      return {
        ...base,
        surface: route === 'tree' ? GitHubSurface.Directory : GitHubSurface.File,
        branch: ref,
        path,
      };
    }
    case 'commit': {
      const sha = rest[0];
      return {
        ...base,
        surface: GitHubSurface.Commit,
        commitSha: isSafeCommitSha(sha) ? sha : null,
      };
    }
    case 'pull': {
      return {
        ...base,
        surface: GitHubSurface.PullRequest,
        pullRequestNumber: positiveInt(rest[0]),
      };
    }
    case 'issues': {
      const number = positiveInt(rest[0]);
      return number === null
        ? { ...base, surface: GitHubSurface.Unknown }
        : { ...base, surface: GitHubSurface.Issue, issueNumber: number };
    }
    case 'discussions': {
      const number = positiveInt(rest[0]);
      return number === null
        ? { ...base, surface: GitHubSurface.Unknown }
        : { ...base, surface: GitHubSurface.Discussion, discussionNumber: number };
    }
    case 'releases': {
      const tag = rest[0] === 'tag' && isSafeTag(rest[1]) ? rest[1] : null;
      return {
        ...base,
        surface: GitHubSurface.Release,
        releaseTag: tag,
      };
    }
    case 'search': {
      return {
        ...base,
        surface: GitHubSurface.Search,
        searchQuery: sanitizeSearchQuery(parsed.searchParams.get('q') ?? ''),
      };
    }
    default: {
      if (UNSUPPORTED_REPO_ROUTES.has(route)) {
        // Identity is still known — the surface simply is not one of the
        // supported developer surfaces.
        return { ...base, surface: GitHubSurface.Unknown };
      }
      return { ...base, surface: GitHubSurface.Unknown };
    }
  }
}

export { GITHUB_CODE_PATH };
