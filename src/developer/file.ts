/**
 * Phase 7 — file-level intelligence.
 *
 * The "current file" is whatever bounded code slice the page exposed: GitHub
 * only renders a window of lines for large files, and CommandLayer never
 * fetches the rest. What we have is what we use, and the summary says which
 * lines were read.
 */
import type { GitHubPageContext } from '@/github/types';
import { DEVELOPER_LIMITS } from './limits';
import { isConfigFile, isDocumentationFile, isTestFile, languageHint } from './language';
import type { DeveloperRepositorySummary } from './types';

export interface DeveloperFileContext {
  path: string;
  language: string | null;
  lines: Array<{ number: number; text: string }>;
  /** True when the file also looks like a test, config, or docs file. */
  classification: 'test' | 'config' | 'documentation' | 'source';
  /** Whether the code slice is complete for the rendered page. */
  truncated: boolean;
}

export function currentFileContext(
  github: GitHubPageContext,
): DeveloperFileContext | null {
  if (github.surface !== 'file') return null;
  if (!github.path || github.codeLines.length === 0) return null;

  const lines = github.codeLines
    .slice(0, DEVELOPER_LIMITS.MAX_CODE_LINES)
    .map((line) => ({ number: line.number, text: line.text }));

  const classification = isTestFile(github.path)
    ? 'test'
    : isConfigFile(github.path)
      ? 'config'
      : isDocumentationFile(github.path)
        ? 'documentation'
        : 'source';

  return {
    path: github.path,
    language: languageHint(github.language, github.path),
    lines,
    classification,
    truncated: github.truncated || github.codeLines.length > lines.length,
  };
}

/** Deterministic one-line description of the current file. */
export function describeFile(context: DeveloperFileContext): string {
  const first = context.lines[0]?.number ?? 0;
  const last = context.lines[context.lines.length - 1]?.number ?? 0;
  const range = first > 0 && last >= first ? ` (lines ${first}–${last} read)` : '';
  const language = context.language ? ` · ${context.language}` : '';
  return `${context.path}${language}${range}`;
}

/** Observations about the current file, all counts — no interpretation. */
export function fileObservations(
  github: GitHubPageContext,
  repository: DeveloperRepositorySummary,
): string[] {
  const observations: string[] = [];
  if (github.path) observations.push(`File: ${github.path}`);
  if (repository.language) observations.push(`Language: ${repository.language}`);
  if (github.codeLines.length > 0) {
    observations.push(`Code lines captured: ${github.codeLines.length}`);
  } else if (github.surface === 'file') {
    observations.push('No code lines were captured from this file page');
  }
  if (github.changedFiles.length > 0) {
    observations.push(`Changed files on this page: ${github.changedFiles.length}`);
  }
  return observations;
}
