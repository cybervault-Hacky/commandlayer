/**
 * Phase 7 — strict parsing of untrusted GitHub payloads.
 *
 * The background NEVER trusts a content-script message: this validator
 * type-checks every field, re-applies the shared identity patterns, enforces
 * the capture limits, and rejects the whole section on any violation
 * (including an unknown key, which is how payload smuggling is attempted).
 *
 * `null` means "no usable GitHub context" — never a partially-trusted one.
 */
import { cleanText } from '@/page-intelligence/sanitizer';
import { GITHUB_LIMITS } from './limits';
import {
  isSafeCommitSha,
  isSafeOwner,
  isSafeRepoPath,
  isSafeRef,
  isSafeRepository,
  isSafeTag,
  sanitizeSearchQuery,
} from './patterns';
import {
  GitHubChangeStatus,
  GitHubSurface,
  GitHubVisibility,
  isGitHubSurface,
  type GitHubChangedFile,
  type GitHubCodeLine,
  type GitHubDiffLine,
  type GitHubFileEntry,
  type GitHubPageContext,
} from './types';

const L = GITHUB_LIMITS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(record).every((key) => set.has(key));
}

function nullableString(
  value: unknown,
  max: number,
  check?: (candidate: string) => boolean,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = cleanText(value, max);
  if (cleaned === null || cleaned.length === 0) return undefined;
  if (check && !check(cleaned)) return undefined;
  return cleaned;
}

function nullableInt(value: unknown, max: number): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > max) return undefined;
  return value;
}

function positiveInt(value: unknown, max: number): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value <= 0 || value > max) return undefined;
  return value;
}

function parseFiles(value: unknown): GitHubFileEntry[] | null {
  if (!Array.isArray(value) || value.length > L.MAX_FILES) return null;
  const files: GitHubFileEntry[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !onlyKeys(entry, ['path', 'kind'])) return null;
    const path = entry.path;
    if (typeof path !== 'string' || !isSafeRepoPath(path)) return null;
    if (entry.kind !== 'file' && entry.kind !== 'directory' && entry.kind !== 'unknown') {
      return null;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    files.push({ path, kind: entry.kind });
  }
  return files;
}

function parseChangedFiles(value: unknown): GitHubChangedFile[] | null {
  if (!Array.isArray(value) || value.length > L.MAX_CHANGED_FILES) return null;
  const statuses = new Set<string>(Object.values(GitHubChangeStatus));
  const files: GitHubChangedFile[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !onlyKeys(entry, ['path', 'status', 'additions', 'deletions'])
    ) {
      return null;
    }
    const path = entry.path;
    if (typeof path !== 'string' || !isSafeRepoPath(path)) return null;
    const status = entry.status;
    if (typeof status !== 'string' || !statuses.has(status)) return null;
    const additions = nullableInt(entry.additions, 9_999_999);
    const deletions = nullableInt(entry.deletions, 9_999_999);
    if (additions === undefined || deletions === undefined) return null;
    if (seen.has(path)) continue;
    seen.add(path);
    files.push({
      path,
      status: status as GitHubChangedFile['status'],
      additions,
      deletions,
    });
  }
  return files;
}

function parseCodeLines(value: unknown): GitHubCodeLine[] | null {
  if (!Array.isArray(value) || value.length > L.MAX_CODE_LINES) return null;
  const lines: GitHubCodeLine[] = [];
  let characters = 0;
  for (const entry of value) {
    if (!isRecord(entry) || !onlyKeys(entry, ['number', 'text'])) return null;
    const number = entry.number;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 5_000_000) {
      return null;
    }
    const text = cleanText(String(entry.text ?? ''), L.MAX_CODE_LINE_LENGTH);
    if (text === null) return null;
    characters += text.length;
    if (characters > L.MAX_CODE_CHARACTERS) return null;
    lines.push({ number, text });
  }
  return lines;
}

function parseDiffLines(value: unknown): GitHubDiffLine[] | null {
  if (!Array.isArray(value) || value.length > L.MAX_DIFF_LINES) return null;
  const lines: GitHubDiffLine[] = [];
  let characters = 0;
  for (const entry of value) {
    if (!isRecord(entry) || !onlyKeys(entry, ['kind', 'text', 'oldLine', 'newLine'])) return null;
    const kind = entry.kind;
    if (kind !== '+' && kind !== '-' && kind !== ' ') return null;
    const text = cleanText(String(entry.text ?? ''), L.MAX_DIFF_LINE_LENGTH);
    if (text === null) return null;
    const oldLine = nullableInt(entry.oldLine, 5_000_000);
    const newLine = nullableInt(entry.newLine, 5_000_000);
    if (oldLine === undefined || newLine === undefined) return null;
    characters += text.length;
    if (characters > L.MAX_DIFF_CHARACTERS) return null;
    lines.push({ kind, text, oldLine, newLine });
  }
  return lines;
}

/**
 * Parse + validate an untrusted GitHub section. Returns null on ANY
 * violation (missing field, wrong type, out-of-contract key, oversized
 * collection, unsafe identity).
 */
export function parseGitHubPageContext(value: unknown): GitHubPageContext | null {
  if (!isRecord(value)) return null;
  if (
    !onlyKeys(value, [
      'surface',
      'owner',
      'repository',
      'branch',
      'path',
      'commitSha',
      'pullRequestNumber',
      'issueNumber',
      'discussionNumber',
      'releaseTag',
      'searchQuery',
      'title',
      'description',
      'visibility',
      'language',
      'files',
      'changedFiles',
      'additions',
      'deletions',
      'changedFileCount',
      'codeLines',
      'diffLines',
      'readmeExcerpt',
      'truncated',
      'evidence',
      'capturedAt',
    ])
  ) {
    return null;
  }

  if (!isGitHubSurface(value.surface)) return null;

  const owner = nullableString(value.owner, L.MAX_OWNER_LENGTH, isSafeOwner);
  const repository = nullableString(value.repository, L.MAX_REPOSITORY_LENGTH, isSafeRepository);
  const branch = nullableString(value.branch, L.MAX_REF_LENGTH, isSafeRef);
  const path = nullableString(value.path, L.MAX_PATH_LENGTH, isSafeRepoPath);
  const commitSha = nullableString(value.commitSha, L.MAX_COMMIT_SHA_LENGTH, isSafeCommitSha);
  const releaseTag = nullableString(value.releaseTag, L.MAX_TAG_LENGTH, isSafeTag);
  const pullRequestNumber = positiveInt(value.pullRequestNumber, 9_999_999);
  const issueNumber = positiveInt(value.issueNumber, 9_999_999);
  const discussionNumber = positiveInt(value.discussionNumber, 9_999_999);
  const searchQuery =
    value.searchQuery === null
      ? null
      : sanitizeSearchQuery(value.searchQuery) ?? undefined;

  if (
    owner === undefined ||
    repository === undefined ||
    branch === undefined ||
    path === undefined ||
    commitSha === undefined ||
    releaseTag === undefined ||
    searchQuery === undefined ||
    pullRequestNumber === undefined ||
    issueNumber === undefined ||
    discussionNumber === undefined
  ) {
    return null;
  }
  // Identity must be internally consistent: a repository without an owner (or
  // the reverse) is not a context.
  if ((owner === null) !== (repository === null)) return null;

  const title = nullableString(value.title, L.MAX_TITLE_LENGTH);
  const description = nullableString(value.description, L.MAX_DESCRIPTION_LENGTH);
  const language = nullableString(value.language, L.MAX_LANGUAGE_LENGTH);
  if (title === undefined || description === undefined || language === undefined) return null;

  const visibility = value.visibility;
  if (
    visibility !== GitHubVisibility.Public &&
    visibility !== GitHubVisibility.Private &&
    visibility !== GitHubVisibility.Unknown
  ) {
    return null;
  }

  const files = parseFiles(value.files);
  const changedFiles = parseChangedFiles(value.changedFiles);
  const codeLines = parseCodeLines(value.codeLines);
  const diffLines = parseDiffLines(value.diffLines);
  if (!files || !changedFiles || !codeLines || !diffLines) return null;

  const additions = nullableInt(value.additions, 9_999_999);
  const deletions = nullableInt(value.deletions, 9_999_999);
  const changedFileCount = nullableInt(value.changedFileCount, L.MAX_CHANGED_FILE_COUNT);
  if (additions === undefined || deletions === undefined || changedFileCount === undefined) {
    return null;
  }

  const readmeExcerpt =
    value.readmeExcerpt === null
      ? null
      : cleanText(String(value.readmeExcerpt ?? ''), L.MAX_README_CHARACTERS) ?? undefined;
  if (readmeExcerpt === undefined) return null;

  if (typeof value.truncated !== 'boolean') return null;

  const evidence = value.evidence;
  if (!isRecord(evidence) || !onlyKeys(evidence, ['url', 'meta', 'dom'])) return null;
  if (
    typeof evidence.url !== 'boolean' ||
    typeof evidence.meta !== 'boolean' ||
    typeof evidence.dom !== 'boolean'
  ) {
    return null;
  }

  const capturedAt = value.capturedAt;
  if (
    typeof capturedAt !== 'string' ||
    capturedAt.length > 40 ||
    !Number.isFinite(Date.parse(capturedAt))
  ) {
    return null;
  }

  // Surface ↔ identity consistency: supported surfaces require the identity
  // they are built on (never a context that claims a file with no path).
  const surface = value.surface as GitHubSurface;
  switch (surface) {
    case GitHubSurface.File:
    case GitHubSurface.Directory:
      if (owner === null || path === null) return null;
      break;
    case GitHubSurface.Commit:
      if (owner === null || commitSha === null) return null;
      break;
    case GitHubSurface.PullRequest:
      if (owner === null || pullRequestNumber === null) return null;
      break;
    case GitHubSurface.Issue:
      if (owner === null || issueNumber === null) return null;
      break;
    case GitHubSurface.Discussion:
      if (owner === null || discussionNumber === null) return null;
      break;
    case GitHubSurface.Search:
      if (searchQuery === null) return null;
      break;
    default:
      break;
  }

  return {
    surface,
    owner,
    repository,
    branch,
    path,
    commitSha,
    pullRequestNumber,
    issueNumber,
    discussionNumber,
    releaseTag,
    searchQuery,
    title,
    description,
    visibility,
    language,
    files,
    changedFiles,
    additions,
    deletions,
    changedFileCount,
    codeLines,
    diffLines,
    readmeExcerpt,
    truncated: value.truncated,
    evidence: {
      url: evidence.url,
      meta: evidence.meta,
      dom: evidence.dom,
    },
    capturedAt,
  };
}
