/**
 * Phase 7 — repository and file understanding.
 *
 * Built from the validated GitHub context plus the bounded page text: file
 * listings, config-file names, language labels, and a README excerpt. Nothing
 * is downloaded, no repository is cloned, and a surface that did not expose
 * structure reports "unknown" rather than filling the gap with assumptions.
 */
import type { GitHubPageContext } from '@/github/types';
import { DEVELOPER_LIMITS } from './limits';
import { frameworkHintsFrom, isConfigFile, languageHint } from './language';
import type { DeveloperRepositorySummary } from './types';

export function summarizeRepository(
  github: GitHubPageContext,
): DeveloperRepositorySummary {
  const files = github.files
    .map((entry) => entry.path)
    .slice(0, DEVELOPER_LIMITS.MAX_FILES_LISTED);
  const changedPaths = github.changedFiles
    .map((entry) => entry.path)
    .slice(0, DEVELOPER_LIMITS.MAX_CHANGED_FILES);
  const allFiles = files.length > 0 ? files : changedPaths;

  const configFiles: string[] = [];
  for (const path of allFiles) {
    if (configFiles.length >= DEVELOPER_LIMITS.MAX_CONFIG_FILES) break;
    if (isConfigFile(path)) configFiles.push(path);
  }

  return {
    slug: github.owner && github.repository
      ? `${github.owner}/${github.repository}`
      : null,
    surface: github.surface,
    ref: github.branch,
    path: github.path,
    language: languageHint(github.language, github.path),
    fileCount: allFiles.length,
    files,
    configFiles,
    frameworkHints: frameworkHintsFrom(allFiles).slice(0, DEVELOPER_LIMITS.MAX_FRAMEWORK_HINTS),
    readmeExcerpt: github.readmeExcerpt
      ? github.readmeExcerpt.slice(0, DEVELOPER_LIMITS.MAX_README_EXCERPT)
      : null,
  };
}

/**
 * Deterministic observations about the repository. These are counts and
 * labels only, so the UI and the model both know exactly what was read.
 */
export function repositoryObservations(
  github: GitHubPageContext,
  summary: DeveloperRepositorySummary,
): string[] {
  const observations: string[] = [];
  observations.push(`Surface: ${github.surface.replace('_', ' ')}`);
  if (summary.slug) observations.push(`Repository: ${summary.slug}`);
  if (summary.ref) observations.push(`Ref: ${summary.ref}`);
  if (summary.path) observations.push(`Path: ${summary.path}`);
  if (summary.language) observations.push(`Language: ${summary.language}`);
  if (summary.fileCount > 0) {
    observations.push(`Files visible on this page: ${summary.fileCount}`);
  }
  if (github.codeLines.length > 0) {
    observations.push(`Code lines captured: ${github.codeLines.length}`);
  }
  if (github.changedFiles.length > 0) {
    observations.push(`Changed files captured: ${github.changedFiles.length}`);
  }
  if (summary.configFiles.length > 0) {
    observations.push(`Configuration files visible: ${summary.configFiles.slice(0, 4).join(', ')}`);
  }
  if (summary.frameworkHints.length > 0) {
    observations.push(`Framework/build hints: ${summary.frameworkHints.join(', ')}`);
  }
  if (github.readmeExcerpt) observations.push('README excerpt captured from this page');
  if (github.truncated) observations.push('Some captured sections were truncated by limits');
  return observations.slice(0, DEVELOPER_LIMITS.MAX_OBSERVATIONS);
}

/** A short repository/files listing for the developer result card. */
export function describeRepository(summary: DeveloperRepositorySummary): string {
  if (!summary.slug) {
    return 'This page does not expose a repository identity, so no repository context is available.';
  }
  const parts = [summary.slug];
  if (summary.ref) parts.push(`@ ${summary.ref}`);
  if (summary.language) parts.push(`· ${summary.language}`);
  if (summary.fileCount > 0) parts.push(`· ${summary.fileCount} files visible`);
  return parts.join(' ');
}
