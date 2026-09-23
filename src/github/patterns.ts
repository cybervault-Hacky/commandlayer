/**
 * Phase 7 — the single source of truth for GitHub identity shapes.
 *
 * Both sides of the trust boundary use these patterns: the content-side
 * detector/parser and the background-side validator, plus the Action Engine's
 * GitHub navigation validator and URL builder. Nothing else may define what a
 * safe owner, repository, ref, path, or query looks like.
 *
 * `buildGitHubUrl` is the ONLY place a GitHub URL is constructed, and it
 * accepts only already-validated typed parts — never a user-supplied URL.
 */
import { GITHUB_LIMITS } from './limits';
import { GitHubSurface, type GitHubSurface as Surface } from './types';

export const GITHUB_HOST = 'github.com';
export const GITHUB_ORIGIN = 'https://github.com';

/** Paths that can never be an owner (GitHub's own routes). */
const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'about',
  'account',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'dashboard',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'signup',
  'site',
  'sponsors',
  'topics',
  'trending',
]);

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const TAG = /^[A-Za-z0-9._-]{1,100}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._@+~-]{1,100}$/;
const REF_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

export function isGitHubUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      (url.hostname === GITHUB_HOST || url.hostname === `www.${GITHUB_HOST}`)
    );
  } catch {
    return false;
  }
}

export function isSafeOwner(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= GITHUB_LIMITS.MAX_OWNER_LENGTH + 1 &&
    OWNER.test(value) &&
    !RESERVED_OWNERS.has(value.toLowerCase())
  );
}

export function isReservedOwner(value: string): boolean {
  return RESERVED_OWNERS.has(value.toLowerCase());
}

export function isSafeRepository(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= GITHUB_LIMITS.MAX_REPOSITORY_LENGTH &&
    REPOSITORY.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}

export function isSafeCommitSha(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= GITHUB_LIMITS.MAX_COMMIT_SHA_LENGTH &&
    COMMIT_SHA.test(value)
  );
}

export function isSafeTag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= GITHUB_LIMITS.MAX_TAG_LENGTH &&
    TAG.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}

/**
 * A ref (branch, tag, or sha) may contain slashes. It is accepted only when
 * every segment is a safe ref segment: no `..`, no empty segments, no
 * leading/trailing slash, and no traversal or protocol characters.
 */
export function isSafeRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > GITHUB_LIMITS.MAX_REF_LENGTH) return false;
  if (value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('..') || value.includes('\\')) return false;
  const segments = value.split('/');
  if (segments.length > 12) return false;
  return segments.every((segment) => REF_SEGMENT.test(segment));
}

/**
 * A repository path. Segments are deliberately narrow (no spaces, no
 * percent-escapes, no traversal) so a path can never smuggle a URL, a query,
 * or a fragment into a constructed GitHub URL.
 */
export function isSafeRepoPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > GITHUB_LIMITS.MAX_PATH_LENGTH) return false;
  if (value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('..') || value.includes('\\') || value.includes('//')) return false;
  const segments = value.split('/');
  if (segments.length === 0 || segments.length > GITHUB_LIMITS.MAX_PATH_SEGMENTS) return false;
  return segments.every((segment) => PATH_SEGMENT.test(segment));
}

/** Search queries are displayed, never interpolated into anything executable. */
/**
 * Normalize an untrusted search query: control characters and NUL bytes are
 * removed, whitespace is collapsed, and the result is length-capped. The
 * query stays data — it is never interpreted as markup, a URL, or a command.
 */
export function sanitizeSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- deliberate sanitization
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > GITHUB_LIMITS.MAX_SEARCH_QUERY_LENGTH) {
    return cleaned.slice(0, GITHUB_LIMITS.MAX_SEARCH_QUERY_LENGTH);
  }
  return cleaned;
}

/** Owner/repository relative path shapes used when reading links. */
export const GITHUB_CODE_PATH = /^\/([^/]+)\/([^/]+)\/(?:blob|tree|raw)\//;

export type GitHubNavTarget =
  | { kind: 'repository'; owner: string; repository: string }
  | { kind: 'directory'; owner: string; repository: string; ref?: string; path: string }
  | { kind: 'file'; owner: string; repository: string; ref?: string; path: string }
  | { kind: 'commit'; owner: string; repository: string; sha: string }
  | { kind: 'pull_request'; owner: string; repository: string; number: number }
  | { kind: 'issue'; owner: string; repository: string; number: number }
  | { kind: 'search'; query: string; owner?: string; repository?: string };

export function isNavTargetKind(value: unknown): value is GitHubNavTarget['kind'] {
  return (
    value === 'repository' ||
    value === 'directory' ||
    value === 'file' ||
    value === 'commit' ||
    value === 'pull_request' ||
    value === 'issue' ||
    value === 'search'
  );
}

/** A short, user-facing label for a navigation target (never a raw URL). */
export function describeNavTarget(target: GitHubNavTarget): string {
  switch (target.kind) {
    case 'repository':
      return `the ${target.owner}/${target.repository} repository`;
    case 'directory':
      return `the ${target.path} directory in ${target.owner}/${target.repository}`;
    case 'file':
      return `${target.path} in ${target.owner}/${target.repository}`;
    case 'commit':
      return `commit ${target.sha.slice(0, 7)} in ${target.owner}/${target.repository}`;
    case 'pull_request':
      return `pull request #${target.number} in ${target.owner}/${target.repository}`;
    case 'issue':
      return `issue #${target.number} in ${target.owner}/${target.repository}`;
    case 'search':
      return target.owner && target.repository
        ? `the search for “${target.query}” in ${target.owner}/${target.repository}`
        : `the GitHub search for “${target.query}”`;
  }
}

/**
 * Build the canonical GitHub URL for a VALIDATED target. Returns null if any
 * part is not valid: there is no path from an arbitrary string to a URL here.
 */
export function buildGitHubUrl(target: GitHubNavTarget): string | null {
  if (target.kind === 'search') {
    const query = sanitizeSearchQuery(target.query);
    if (!query || query.length > GITHUB_LIMITS.SEARCH_MAX_QUERY_LENGTH) return null;
    if (target.owner !== undefined || target.repository !== undefined) {
      if (!isSafeOwner(target.owner) || !isSafeRepository(target.repository)) return null;
      return `${GITHUB_ORIGIN}/${target.owner}/${target.repository}/search?q=${encodeURIComponent(query)}&type=code`;
    }
    return `${GITHUB_ORIGIN}/search?q=${encodeURIComponent(query)}&type=code`;
  }

  if (!isSafeOwner(target.owner) || !isSafeRepository(target.repository)) return null;
  const base = `${GITHUB_ORIGIN}/${target.owner}/${target.repository}`;

  switch (target.kind) {
    case 'repository':
      return base;
    case 'directory':
      if (!isSafeRepoPath(target.path)) return null;
      return `${base}/tree/${encodeRef(target.ref)}/${encodePath(target.path)}`;
    case 'file':
      if (!isSafeRepoPath(target.path)) return null;
      return `${base}/blob/${encodeRef(target.ref)}/${encodePath(target.path)}`;
    case 'commit':
      if (!isSafeCommitSha(target.sha)) return null;
      return `${base}/commit/${target.sha}`;
    case 'pull_request':
      if (!isSafeNumber(target.number)) return null;
      return `${base}/pull/${target.number}`;
    case 'issue':
      if (!isSafeNumber(target.number)) return null;
      return `${base}/issues/${target.number}`;
  }
}

/** The surface a navigation target lands on (used for verification). */
export function surfaceForNavTarget(target: GitHubNavTarget): Surface {
  switch (target.kind) {
    case 'repository':
      return GitHubSurface.Repository;
    case 'directory':
      return GitHubSurface.Directory;
    case 'file':
      return GitHubSurface.File;
    case 'commit':
      return GitHubSurface.Commit;
    case 'pull_request':
      return GitHubSurface.PullRequest;
    case 'issue':
      return GitHubSurface.Issue;
    case 'search':
      return GitHubSurface.Search;
  }
}

function isSafeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 9_999_999;
}

function encodeRef(ref: string | undefined): string {
  // The default branch name is only used when the page did not state a ref;
  // it is a literal, never user input.
  return ref ? ref.split('/').map(encodeURIComponent).join('/') : 'HEAD';
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Exact field sets per navigation target kind (closed contract). */
const NAV_FIELDS: Record<GitHubNavTarget['kind'], readonly string[]> = {
  repository: ['kind', 'owner', 'repository'],
  directory: ['kind', 'owner', 'repository', 'ref', 'path'],
  file: ['kind', 'owner', 'repository', 'ref', 'path'],
  commit: ['kind', 'owner', 'repository', 'sha'],
  pull_request: ['kind', 'owner', 'repository', 'number'],
  issue: ['kind', 'owner', 'repository', 'number'],
  search: ['kind', 'query', 'owner', 'repository'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an untrusted navigation target. This is the ONLY way a target enters
 * an action payload: the typed parts are re-validated and, as a final check,
 * the target must still produce a well-formed github.com URL. A raw URL
 * string is not a valid target and never will be.
 */
export function parseNavTarget(value: unknown): GitHubNavTarget | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (!isNavTargetKind(kind)) return null;
  const allowed = NAV_FIELDS[kind];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return null;
  }

  let target: GitHubNavTarget | null = null;
  switch (kind) {
    case 'repository':
      if (isSafeOwner(value.owner) && isSafeRepository(value.repository)) {
        target = { kind, owner: value.owner, repository: value.repository };
      }
      break;
    case 'directory':
    case 'file': {
      const ref = value.ref === undefined ? undefined : value.ref;
      if (ref !== undefined && !isSafeRef(ref)) break;
      if (isSafeOwner(value.owner) && isSafeRepository(value.repository) && isSafeRepoPath(value.path)) {
        target = {
          kind,
          owner: value.owner,
          repository: value.repository,
          ...(typeof ref === 'string' ? { ref } : {}),
          path: value.path,
        };
      }
      break;
    }
    case 'commit':
      if (isSafeOwner(value.owner) && isSafeRepository(value.repository) && isSafeCommitSha(value.sha)) {
        target = { kind, owner: value.owner, repository: value.repository, sha: value.sha };
      }
      break;
    case 'pull_request':
    case 'issue':
      if (isSafeOwner(value.owner) && isSafeRepository(value.repository) && isSafeNumber(value.number)) {
        target = { kind, owner: value.owner, repository: value.repository, number: value.number };
      }
      break;
    case 'search': {
      const query = sanitizeSearchQuery(value.query);
      if (query === null) break;
      const hasRepo = value.owner !== undefined || value.repository !== undefined;
      if (hasRepo && !(isSafeOwner(value.owner) && isSafeRepository(value.repository))) break;
      target = hasRepo
        ? { kind, query, owner: value.owner as string, repository: value.repository as string }
        : { kind, query };
      break;
    }
  }

  if (target === null) return null;
  return buildGitHubUrl(target) === null ? null : target;
}
