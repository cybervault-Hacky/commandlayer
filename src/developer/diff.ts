/**
 * Phase 7 — change-set analysis (pull requests, commits).
 *
 * Everything here is derived from the captured GitHub context: the changed
 * file list, the diffstat GitHub rendered, and the bounded diff excerpt. No
 * file is fetched, no patch is reconstructed, and missing information is
 * reported as missing (`hasDiffExcerpt: false`) instead of guessed.
 */
import type { GitHubPageContext } from '@/github/types';
import { DEVELOPER_LIMITS } from './limits';
import {
  isConfigFile,
  isDocumentationFile,
  isSensitivePath,
  isTestFile,
} from './language';
import { ChangeCategory, type DeveloperChangeSummary } from './types';

export { ChangeCategory };

const DEPENDENCY_FILES: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'pipfile',
  'pipfile.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'gemfile',
  'gemfile.lock',
  'composer.json',
  'composer.lock',
  'pubspec.yaml',
  'mix.exs',
]);

const ASSET_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|pdf|avif)$/i;

export function classifyChange(path: string): ChangeCategory {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (DEPENDENCY_FILES.has(base)) return ChangeCategory.Dependency;
  if (isTestFile(path)) return ChangeCategory.Tests;
  if (isDocumentationFile(path)) return ChangeCategory.Documentation;
  if (ASSET_EXTENSIONS.test(path)) return ChangeCategory.Assets;
  if (isConfigFile(path)) return ChangeCategory.Configuration;
  if (/\.[a-z0-9]{1,8}$/i.test(path)) return ChangeCategory.Source;
  return ChangeCategory.Other;
}

/**
 * Summarize the change set. `changedFileCount` is the number the page stated
 * (GitHub renders it for large pull requests) and falls back to what was
 * actually captured — the difference is visible in `truncated`.
 */
export function summarizeChange(github: GitHubPageContext): DeveloperChangeSummary | null {
  const isChangeSurface =
    github.surface === 'pull_request' || github.surface === 'commit';
  if (!isChangeSurface) return null;
  if (github.changedFiles.length === 0 && github.additions === null && github.deletions === null) {
    return null;
  }

  const categories: ChangeCategory[] = [];
  const sensitiveFiles: string[] = [];
  for (const file of github.changedFiles) {
    const category = classifyChange(file.path);
    if (!categories.includes(category)) categories.push(category);
    if (isSensitivePath(file.path) && sensitiveFiles.length < DEVELOPER_LIMITS.MAX_SENSITIVE_FILES) {
      sensitiveFiles.push(file.path);
    }
  }

  return {
    changedFiles: github.changedFiles.slice(0, DEVELOPER_LIMITS.MAX_CHANGED_FILES),
    changedFileCount: github.changedFileCount ?? github.changedFiles.length,
    additions: github.additions,
    deletions: github.deletions,
    categories,
    sensitiveFiles,
    hasDiffExcerpt: github.diffLines.length > 0,
    diffLineCount: github.diffLines.length,
  };
}

/** Human-readable, deterministic one-liner for the change set. */
export function describeChange(summary: DeveloperChangeSummary): string {
  const files = `${summary.changedFileCount} changed file${summary.changedFileCount === 1 ? '' : 's'}`;
  const stat =
    summary.additions !== null || summary.deletions !== null
      ? ` (+${summary.additions ?? '?'} −${summary.deletions ?? '?'})`
      : '';
  const categories =
    summary.categories.length > 0 ? ` · ${summary.categories.join(', ')}` : '';
  return `${files}${stat}${categories}`;
}
