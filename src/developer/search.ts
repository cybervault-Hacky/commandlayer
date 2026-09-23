/**
 * Phase 7 — bounded code search.
 *
 * The search runs ENTIRELY on the context the user's page already provided:
 * the bounded code slice of the file they are viewing, the bounded diff
 * excerpt of the pull request they are viewing, the page's readable text, and
 * the file list. There is no repository download, no recursion, no
 * filesystem, no API call.
 *
 * Bounds enforced here: files scanned, hits returned, snippet length, and a
 * wall-clock timeout. Hitting any bound sets `truncated` and the result is
 * reported honestly.
 */
import { GITHUB_LIMITS } from '@/github/limits';
import type { GitHubDiffLine, GitHubPageContext } from '@/github/types';
import { DEVELOPER_LIMITS } from './limits';
import type { DeveloperSearchHit, DeveloperSearchOutcome } from './types';

export interface DeveloperSearchInput {
  query: string;
  github: GitHubPageContext;
  /** Bounded readable page text (repository README, issue body, …). */
  pageText: string;
  /** Injectable clock so the timeout is testable. */
  now?: () => number;
}

const WORK_MARKERS = /\b(TODO|FIXME|HACK|XXX|NOTE)\b[:\s]?/;

function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.+#/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 6);
}

function snippet(text: string, tokens: readonly string[]): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;
  const lower = flat.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index !== -1) break;
  }
  const radius = DEVELOPER_LIMITS.SNIPPET_RADIUS;
  const start = index === -1 ? 0 : Math.max(0, index - radius);
  const end = Math.min(
    flat.length,
    (index === -1 ? 0 : index + radius) + DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET,
  );
  const slice = flat.slice(start, end).trim();
  return slice.length === 0
    ? null
    : slice.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET);
}

function matches(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const lower = text.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

/**
 * Run one bounded local search across everything already captured.
 * Deterministic: same context + same query = same hits.
 */
export function searchDeveloperContext(
  input: DeveloperSearchInput,
): DeveloperSearchOutcome {
  const tokens = normalizeQuery(input.query);
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const hits: DeveloperSearchHit[] = [];
  let truncated = false;

  const add = (hit: DeveloperSearchHit): boolean => {
    if (hits.length >= DEVELOPER_LIMITS.MAX_SEARCH_HITS) {
      truncated = true;
      return false;
    }
    hits.push(hit);
    return true;
  };

  if (tokens.length === 0) {
    return { query: input.query, hits: [], scanned: 0, truncated: false };
  }

  const { github } = input;
  let scanned = 0;

  // 1. The bounded code slice of the file being viewed.
  if (github.codeLines.length > 0) {
    scanned += 1;
    for (const line of github.codeLines) {
      if (now() - startedAt > DEVELOPER_LIMITS.SEARCH_TIMEOUT_MS) {
        truncated = true;
        break;
      }
      if (!matches(line.text, tokens)) continue;
      const text = snippet(line.text, tokens);
      if (!text) continue;
      if (!add({ path: github.path, line: line.number, snippet: text, source: 'code' })) break;
    }
  }

  // 2. The bounded diff excerpt of the pull request / commit being viewed.
  if (github.diffLines.length > 0) {
    scanned += 1;
    let lineNumber = 0;
    for (const row of github.diffLines) {
      lineNumber += 1;
      if (now() - startedAt > DEVELOPER_LIMITS.SEARCH_TIMEOUT_MS) {
        truncated = true;
        break;
      }
      if (!matches(row.text, tokens)) continue;
      const text = snippet(row.text, tokens);
      if (!text) continue;
      if (!add({ path: github.path, line: row.newLine ?? row.oldLine ?? lineNumber, snippet: text, source: 'diff' })) {
        break;
      }
    }
  }

  // 3. The file list (path matches — "where is this defined/implemented").
  if (github.files.length > 0) {
    scanned += Math.min(github.files.length, DEVELOPER_LIMITS.MAX_SEARCH_FILES);
    for (const file of github.files.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_FILES)) {
      if (now() - startedAt > DEVELOPER_LIMITS.SEARCH_TIMEOUT_MS) {
        truncated = true;
        break;
      }
      if (!matches(file.path, tokens)) continue;
      if (!add({ path: file.path, line: null, snippet: file.path, source: 'file-list' })) break;
    }
  }

  // 4. Readable page text (README, issue body, description).
  if (input.pageText.length > 0) {
    scanned += 1;
    const paragraphs = input.pageText.split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/);
    for (const paragraph of paragraphs) {
      if (now() - startedAt > DEVELOPER_LIMITS.SEARCH_TIMEOUT_MS) {
        truncated = true;
        break;
      }
      if (!matches(paragraph, tokens)) continue;
      const text = snippet(paragraph, tokens);
      if (!text) continue;
      if (!add({ path: null, line: null, snippet: text, source: 'page-text' })) break;
    }
  }

  return { query: input.query, hits, scanned, truncated };
}

export interface WorkMarkerHit {
  path: string | null;
  line: number | null;
  marker: string;
  text: string;
}

/**
 * Deterministic TODO/FIXME/HACK discovery over the captured context. Reports
 * the marker and its exact text — nothing is inferred.
 */
export function findWorkMarkers(github: GitHubPageContext): WorkMarkerHit[] {
  const found: WorkMarkerHit[] = [];

  for (const line of github.codeLines) {
    const match = WORK_MARKERS.exec(line.text);
    if (!match) continue;
    found.push({
      path: github.path,
      line: line.number,
      marker: match[1] ?? 'TODO',
      text: line.text.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
    });
    if (found.length >= DEVELOPER_LIMITS.MAX_SEARCH_HITS) return found;
  }

  for (const row of github.diffLines) {
    const match = WORK_MARKERS.exec(row.text);
    if (!match) continue;
    found.push({
      path: github.path,
      line: row.newLine ?? row.oldLine ?? null,
      marker: match[1] ?? 'TODO',
      text: row.text.slice(0, DEVELOPER_LIMITS.MAX_SEARCH_SNIPPET),
    });
    if (found.length >= DEVELOPER_LIMITS.MAX_SEARCH_HITS) return found;
  }

  return found;
}

/** Diff rows only (used by the change analysis). */
export function diffText(diffLines: readonly GitHubDiffLine[]): string {
  return diffLines
    .slice(0, GITHUB_LIMITS.MAX_DIFF_LINES)
    .map((row) => `${row.kind}${row.text}`)
    .join('\n');
}
