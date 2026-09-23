/**
 * Phase 7 — GitHub context model.
 *
 * A typed, bounded description of the GitHub surface the user is looking at.
 * Two rules shape every field here:
 *
 * 1. STRUCTURE, NOT SCRAPING. Surface detection is URL-first (deterministic
 *    and testable) and identity is corroborated by page metadata and link
 *    structure — never by a single fragile CSS selector.
 * 2. NO OVER-COLLECTION. Only what the user's own GitHub page renders is
 *    captured, only in bounded amounts, and only for the surfaces that have a
 *    developer use case. No private data is fetched, and nothing outside the
 *    visible page is ever requested.
 *
 * The content script produces this shape; the background re-validates it with
 * `parseGitHubPageContext` before any of it can reach the developer layer.
 */

export const GitHubSurface = {
  Repository: 'repository',
  File: 'file',
  Directory: 'directory',
  Commit: 'commit',
  PullRequest: 'pull_request',
  Issue: 'issue',
  Discussion: 'discussion',
  Release: 'release',
  Search: 'search',
  Unknown: 'unknown',
} as const;

export type GitHubSurface = (typeof GitHubSurface)[keyof typeof GitHubSurface];

export const GITHUB_SURFACES: readonly GitHubSurface[] = Object.values(GitHubSurface);

export function isGitHubSurface(value: unknown): value is GitHubSurface {
  return typeof value === 'string' && GITHUB_SURFACES.includes(value as GitHubSurface);
}

export const GitHubVisibility = {
  Public: 'public',
  Private: 'private',
  Unknown: 'unknown',
} as const;

export type GitHubVisibility =
  (typeof GitHubVisibility)[keyof typeof GitHubVisibility];

/** How the identity in a context was established (reported honestly). */
export interface GitHubEvidence {
  /** Owner/repository resolved from the URL path. */
  url: boolean;
  /** Identity corroborated by GitHub's own page metadata. */
  meta: boolean;
  /** Lists/paths found in the rendered document. */
  dom: boolean;
}

/** A file or directory entry listed on a repository/directory page. */
export interface GitHubFileEntry {
  path: string;
  kind: 'file' | 'directory' | 'unknown';
}

export const GitHubChangeStatus = {
  Added: 'added',
  Removed: 'removed',
  Modified: 'modified',
  Renamed: 'renamed',
  Unknown: 'unknown',
} as const;

export type GitHubChangeStatus =
  (typeof GitHubChangeStatus)[keyof typeof GitHubChangeStatus];

/** One file in a pull request / commit change set (never the full diff). */
export interface GitHubChangedFile {
  path: string;
  status: GitHubChangeStatus;
  /** Diffstat when the page states it; null when it does not. */
  additions: number | null;
  deletions: number | null;
}

/** One bounded line of a rendered unified diff. */
export interface GitHubDiffLine {
  kind: '+' | '-' | ' ';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

/** One bounded line of a rendered code file. */
export interface GitHubCodeLine {
  number: number;
  text: string;
}

export interface GitHubPageContext {
  surface: GitHubSurface;

  owner: string | null;
  repository: string | null;
  /** Branch or ref the page is showing, when the page states it. */
  branch: string | null;
  /** File or directory path within the repository. */
  path: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  issueNumber: number | null;
  discussionNumber: number | null;
  releaseTag: string | null;
  /** Search query when the page is a GitHub search result page. */
  searchQuery: string | null;

  title: string | null;
  description: string | null;
  visibility: GitHubVisibility;
  /** Primary language GitHub states for the repository, when present. */
  language: string | null;

  /** Directory listing / repository file entries (bounded). */
  files: GitHubFileEntry[];
  /** Pull request / commit change set (bounded, no diff bodies). */
  changedFiles: GitHubChangedFile[];
  additions: number | null;
  deletions: number | null;
  changedFileCount: number | null;

  /** Bounded rendered code slice (file pages). */
  codeLines: GitHubCodeLine[];
  /** Bounded rendered diff excerpt (pull request / commit pages). */
  diffLines: GitHubDiffLine[];
  /** Bounded README excerpt (repository pages). */
  readmeExcerpt: string | null;

  /** True when any bounded section was cut short. */
  truncated: boolean;
  evidence: GitHubEvidence;
  capturedAt: string;
}

/** An empty context for a non-GitHub (or undetectable) page. */
export function createEmptyGitHubContext(
  capturedAt: string,
): GitHubPageContext {
  return {
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
    title: null,
    description: null,
    visibility: GitHubVisibility.Unknown,
    language: null,
    files: [],
    changedFiles: [],
    additions: null,
    deletions: null,
    changedFileCount: null,
    codeLines: [],
    diffLines: [],
    readmeExcerpt: null,
    truncated: false,
    evidence: { url: false, meta: false, dom: false },
    capturedAt,
  };
}

/** The repository slug, when both halves are known. */
export function repositorySlug(
  context: Pick<GitHubPageContext, 'owner' | 'repository'>,
): string | null {
  if (!context.owner || !context.repository) return null;
  return `${context.owner}/${context.repository}`;
}
