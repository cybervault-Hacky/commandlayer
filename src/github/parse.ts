/**
 * Phase 7 — GitHub page capture (content script side).
 *
 * Reads ONLY what the user's own rendered GitHub page already shows, in
 * bounded amounts, using several independent signals instead of one fragile
 * CSS selector:
 *
 *   URL (detect.ts)  →  page metadata  →  rendered structure (links,
 *   [data-path] entries, [data-line-number] rows, README article)
 *
 * Every section is independently guarded and independently capped, so a
 * markup change degrades one field instead of breaking the capture. Nothing
 * here touches the network, storage, form values, or user input.
 */
import { cleanText } from '@/page-intelligence/sanitizer';
import { GITHUB_LIMITS } from './limits';
import { detectGitHub, type GitHubDetection } from './detect';
import {
  isSafeOwner,
  isSafeRepoPath,
  isSafeRepository,
} from './patterns';
import {
  GitHubChangeStatus,
  GitHubSurface,
  GitHubVisibility,
  createEmptyGitHubContext,
  type GitHubChangedFile,
  type GitHubCodeLine,
  type GitHubDiffLine,
  type GitHubFileEntry,
  type GitHubPageContext,
} from './types';

const L = GITHUB_LIMITS;

function metaContent(doc: Document, names: readonly string[]): string | null {
  for (const name of names) {
    const element = doc.querySelector(`meta[name="${name}"]`);
    const content = element?.getAttribute('content');
    if (content && content.trim().length > 0) return content;
  }
  return null;
}

function attrText(element: Element | null, name: string, max: number): string | null {
  if (!element) return null;
  return cleanText(element.getAttribute(name) ?? '', max);
}

function elementText(element: Element | null, max: number): string | null {
  if (!element) return null;
  return cleanText(element.textContent ?? '', max);
}

/** `https://github.com/owner/repo/(blob|tree)/<ref>/<path>` → path parts. */
function codePathParts(
  href: string,
  owner: string,
  repository: string,
): { kind: 'file' | 'directory'; rest: string[] } | null {
  let url: URL;
  try {
    url = new URL(href, 'https://github.com');
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 5) return null;
  if (segments[0] !== owner || segments[1] !== repository) return null;
  const route = segments[2];
  if (route !== 'blob' && route !== 'tree') return null;
  const rest = segments.slice(3).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  // rest[0] is the ref, everything after it is the path.
  const path = rest.slice(1).join('/');
  if (path.length === 0) return null;
  return { kind: route === 'tree' ? 'directory' : 'file', rest };
}

/**
 * Corroborate the ref from the rendered page: a link to the same path the
 * URL names reveals where the ref ends when the branch contains slashes.
 */
function refFromLinks(
  doc: Document,
  detection: GitHubDetection,
): string | null {
  if (!detection.owner || !detection.repository || !detection.path) return null;
  const anchors = doc.querySelectorAll('a[href]');
  const limit = Math.min(anchors.length, L.MAX_CANDIDATES_SCANNED);
  for (let i = 0; i < limit; i += 1) {
    const anchor = anchors[i];
    const href = anchor?.getAttribute('href');
    if (!href) continue;
    const parts = codePathParts(href, detection.owner, detection.repository);
    if (!parts) continue;
    const path = parts.rest.slice(1).join('/');
    if (path !== detection.path) continue;
    const ref = parts.rest[0];
    if (ref && ref.length > 0 && ref.length <= L.MAX_REF_LENGTH) return ref;
  }
  return null;
}

/** Repository file/directory entries from the rendered tree. */
function extractFiles(
  doc: Document,
  detection: GitHubDetection,
): { files: GitHubFileEntry[]; truncated: boolean } {
  const files: GitHubFileEntry[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const push = (path: string, kind: GitHubFileEntry['kind']): void => {
    if (!isSafeRepoPath(path)) return;
    if (seen.has(path)) return;
    if (files.length >= L.MAX_FILES) {
      truncated = true;
      return;
    }
    seen.add(path);
    files.push({ path, kind });
  };

  if (detection.owner && detection.repository) {
    const anchors = doc.querySelectorAll('a[href]');
    const limit = Math.min(anchors.length, L.MAX_CANDIDATES_SCANNED);
    for (let i = 0; i < limit && !truncated; i += 1) {
      const href = anchors[i]?.getAttribute('href');
      if (!href) continue;
      const parts = codePathParts(href, detection.owner, detection.repository);
      if (!parts) continue;
      push(parts.rest.slice(1).join('/'), parts.kind);
    }
  }

  // Rendered rows carry their path as data — authoritative when present.
  const dataPath = doc.querySelectorAll('[data-path]');
  const limit = Math.min(dataPath.length, L.MAX_CHANGED_FILE_COUNT);
  for (let i = 0; i < limit && !truncated; i += 1) {
    const element = dataPath[i];
    const path = attrText(element ?? null, 'data-path', L.MAX_PATH_LENGTH);
    if (!path) continue;
    const isTree = element?.getAttribute('data-tree-entry-type') === 'tree';
    push(path, isTree ? 'directory' : 'file');
  }

  return { files, truncated };
}

const DIFFSTAT = /\+(\d{1,5})[\s\S]{0,24}?[−-](\d{1,5})/;

function extractChangedFiles(
  doc: Document,
): { changedFiles: GitHubChangedFile[]; truncated: boolean; additions: number | null; deletions: number | null } {
  const changedFiles: GitHubChangedFile[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const elements = doc.querySelectorAll('[data-path]');
  const limit = Math.min(elements.length, L.MAX_CANDIDATES_SCANNED * 4);
  for (let i = 0; i < limit; i += 1) {
    const element = elements[i];
    if (!element) continue;
    const path = attrText(element, 'data-path', L.MAX_PATH_LENGTH);
    if (!path || !isSafeRepoPath(path) || seen.has(path)) continue;
    if (changedFiles.length >= L.MAX_CHANGED_FILES) {
      truncated = true;
      break;
    }
    seen.add(path);

    const container = element.closest('div, li, section') ?? element;
    const statText = cleanText(container.textContent ?? '', 400) ?? '';
    const stat = DIFFSTAT.exec(statText);
    const additions = stat?.[1] ? Number.parseInt(stat[1], 10) : null;
    const deletions = stat?.[2] ? Number.parseInt(stat[2], 10) : null;

    changedFiles.push({
      path,
      status: changeStatusFor(container),
      additions,
      deletions,
    });
  }

  // PR/commit totals: read from the rendered summary when it is available.
  let additions: number | null = null;
  let deletions: number | null = null;
  const summary = cleanText(
    (doc.querySelector('[data-testid="diffstat"]') ??
      doc.querySelector('#diffstat') ??
      doc.querySelector('[aria-label*="changed files"]'))?.textContent ?? '',
    300,
  );
  if (summary) {
    const match = DIFFSTAT.exec(summary);
    if (match?.[1]) additions = Number.parseInt(match[1], 10);
    if (match?.[2]) deletions = Number.parseInt(match[2], 10);
  }

  return { changedFiles, truncated, additions, deletions };
}

function changeStatusFor(container: Element): GitHubChangedFile['status'] {
  const hints = [
    container.getAttribute('data-file-type') ?? '',
    container.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '',
    (container.textContent ?? '').slice(0, 120),
  ]
    .join(' ')
    .toLowerCase();
  if (/\badded\b|\bnew file\b/.test(hints)) return GitHubChangeStatus.Added;
  if (/\bremoved\b|\bdeleted\b/.test(hints)) return GitHubChangeStatus.Removed;
  if (/\brenamed\b/.test(hints)) return GitHubChangeStatus.Renamed;
  if (/\bmodified\b|\bchanged\b/.test(hints)) return GitHubChangeStatus.Modified;
  return GitHubChangeStatus.Unknown;
}

/** Bounded rendered code lines from `[data-line-number]` rows. */
function extractCodeLines(doc: Document): {
  codeLines: GitHubCodeLine[];
  truncated: boolean;
} {
  const codeLines: GitHubCodeLine[] = [];
  const rows = doc.querySelectorAll('[data-line-number]');
  const limit = Math.min(rows.length, L.MAX_CODE_LINES * 2);
  let characters = 0;
  let truncated = false;

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const rawNumber = row.getAttribute('data-line-number');
    if (!rawNumber || !/^\d{1,7}$/.test(rawNumber)) continue;
    const cell = row.closest('tr') ?? row.parentElement ?? row;
    const text = cleanText(cell.textContent ?? '', L.MAX_CODE_LINE_LENGTH) ?? '';
    if (text.length === 0) continue;
    if (codeLines.length >= L.MAX_CODE_LINES || characters + text.length > L.MAX_CODE_CHARACTERS) {
      truncated = true;
      break;
    }
    characters += text.length;
    codeLines.push({ number: Number.parseInt(rawNumber, 10), text });
  }
  return { codeLines, truncated };
}

/** Bounded rendered unified-diff lines (PR / commit pages). */
function extractDiffLines(doc: Document): {
  diffLines: GitHubDiffLine[];
  truncated: boolean;
} {
  const diffLines: GitHubDiffLine[] = [];
  const rows = doc.querySelectorAll('[data-line-number]');
  const limit = Math.min(rows.length, L.MAX_DIFF_LINES * 3);
  let characters = 0;
  let truncated = false;

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const cell = row.closest('tr');
    if (!cell) continue;
    const marker = cell.querySelector('[data-code-marker]')?.getAttribute('data-code-marker');
    const classes = `${cell.className} ${row.className}`.toLowerCase();
    let kind: GitHubDiffLine['kind'] = ' ';
    if (marker === '+') kind = '+';
    else if (marker === '-') kind = '-';
    else if (/\baddition\b|blob-code-addition/.test(classes)) kind = '+';
    else if (/\bdeletion\b|blob-code-deletion/.test(classes)) kind = '-';
    else continue; // not a diff row

    const codeCell =
      cell.querySelector('td:last-child, [data-code-text], code') ?? cell;
    const text = cleanText(codeCell.textContent ?? '', L.MAX_DIFF_LINE_LENGTH) ?? '';
    if (text.length === 0) continue;
    if (
      diffLines.length >= L.MAX_DIFF_LINES ||
      characters + text.length > L.MAX_DIFF_CHARACTERS
    ) {
      truncated = true;
      break;
    }
    characters += text.length;
    const number = row.getAttribute('data-line-number');
    diffLines.push({
      kind,
      text,
      oldLine: kind === '+' ? null : number ? Number.parseInt(number, 10) : null,
      newLine: kind === '-' ? null : number ? Number.parseInt(number, 10) : null,
    });
  }
  return { diffLines, truncated };
}

function extractLanguage(doc: Document): string | null {
  const direct = elementText(doc.querySelector('[itemprop="programmingLanguage"]'), L.MAX_LANGUAGE_LENGTH);
  if (direct && direct.length > 2) return direct;
  const bar = doc.querySelector('[aria-label*="%"]');
  const label = cleanText(bar?.getAttribute('aria-label') ?? '', L.MAX_LANGUAGE_LENGTH);
  if (label && label.length > 2) {
    const word = label.split(/[\s%]/)[0];
    if (word && word.length > 1) return word;
  }
  return null;
}

function extractReadmeExcerpt(doc: Document): string | null {
  const candidates = [
    doc.querySelector('[data-testid="readme"]'),
    doc.querySelector('article.markdown-body'),
    doc.querySelector('.markdown-body'),
  ];
  for (const candidate of candidates) {
    const text = elementText(candidate, L.MAX_README_CHARACTERS);
    if (text && text.length > 0) return text;
  }
  return null;
}

function applyDetection(
  context: GitHubPageContext,
  detection: GitHubDetection,
): void {
  context.surface = detection.surface;
  context.owner = detection.owner;
  context.repository = detection.repository;
  context.branch = detection.branch;
  context.path = detection.path;
  context.commitSha = detection.commitSha;
  context.pullRequestNumber = detection.pullRequestNumber;
  context.issueNumber = detection.issueNumber;
  context.discussionNumber = detection.discussionNumber;
  context.releaseTag = detection.releaseTag;
  context.searchQuery = detection.searchQuery;
  context.evidence.url = detection.owner !== null;
}

/**
 * Capture the GitHub context for a page. Returns null when the page is not a
 * supported GitHub host at all (so nothing GitHub-shaped is ever attached to
 * a regular page).
 */
export function parseGitHubContext(
  doc: Document,
  url: string | undefined | null,
): GitHubPageContext | null {
  const detection = detectGitHub(url);
  if (!detection.isGitHub) return null;

  const context = createEmptyGitHubContext(new Date().toISOString());
  applyDetection(context, detection);
  context.title = elementText(doc.querySelector('title'), L.MAX_TITLE_LENGTH);

  // --- page metadata corroborates (and can correct) the URL identity -------
  try {
    const nwo = cleanText(
      metaContent(doc, [
        'octolytics-dimension-repository_nwo',
        'hovercard-subject-tag',
      ]) ?? '',
      L.MAX_OWNER_LENGTH + L.MAX_REPOSITORY_LENGTH + 2,
    );
    if (nwo && nwo.includes('/')) {
      const [owner, repository] = nwo.split('/');
      if (isSafeOwner(owner) && isSafeRepository(repository)) {
        context.owner = owner;
        context.repository = repository;
        context.evidence.meta = true;
      }
    }
    const isPublic = metaContent(doc, ['octolytics-dimension-repository_public']);
    if (isPublic === 'true') context.visibility = GitHubVisibility.Public;
    else if (isPublic === 'false') context.visibility = GitHubVisibility.Private;

    const title =
      cleanText(metaContent(doc, ['og:title']) ?? '', L.MAX_TITLE_LENGTH) ??
      context.title;
    context.title = title;

    const description =
      cleanText(metaContent(doc, ['og:description']) ?? '', L.MAX_DESCRIPTION_LENGTH) ??
      cleanText(metaContent(doc, ['description']) ?? '', L.MAX_DESCRIPTION_LENGTH);
    context.description = description;
  } catch {
    // Metadata stays whatever the URL gave us.
  }

  try {
    const ref = refFromLinks(doc, detection);
    if (ref) {
      context.branch = ref;
      context.evidence.dom = true;
    }
  } catch {
    /* keep the URL-derived ref */
  }

  try {
    context.language = extractLanguage(doc);
  } catch {
    /* language is optional */
  }

  if (
    context.surface === GitHubSurface.Repository ||
    context.surface === GitHubSurface.Directory
  ) {
    try {
      const { files, truncated } = extractFiles(doc, detection);
      context.files = files;
      context.truncated = context.truncated || truncated;
    } catch {
      /* no listing */
    }
  }

  if (
    context.surface === GitHubSurface.PullRequest ||
    context.surface === GitHubSurface.Commit
  ) {
    try {
      const { changedFiles, truncated, additions, deletions } =
        extractChangedFiles(doc);
      context.changedFiles = changedFiles;
      context.additions = additions;
      context.deletions = deletions;
      context.truncated = context.truncated || truncated;
    } catch {
      /* no change set */
    }
    try {
      const { diffLines, truncated } = extractDiffLines(doc);
      context.diffLines = diffLines;
      context.truncated = context.truncated || truncated;
    } catch {
      /* diff excerpt unavailable — reported honestly by the developer layer */
    }
  }

  if (context.surface === GitHubSurface.File) {
    try {
      const { codeLines, truncated } = extractCodeLines(doc);
      context.codeLines = codeLines;
      context.truncated = context.truncated || truncated;
    } catch {
      /* file body unavailable */
    }
  }

  if (context.surface === GitHubSurface.Repository) {
    try {
      context.readmeExcerpt = extractReadmeExcerpt(doc);
    } catch {
      /* readme unavailable */
    }
  }

  // Evidence honesty: `dom` records that at least one field came from the
  // rendered page rather than from the URL alone — never that the page was
  // read in full.
  if (
    context.files.length > 0 ||
    context.changedFiles.length > 0 ||
    context.diffLines.length > 0 ||
    context.codeLines.length > 0 ||
    context.readmeExcerpt !== null
  ) {
    context.evidence.dom = true;
  }

  return context;
}
