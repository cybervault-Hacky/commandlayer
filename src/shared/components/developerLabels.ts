/**
 * Phase 7 — developer-facing labels.
 *
 * Kept out of the component files so each component module exports only
 * components (fast-refresh friendly) and so the vocabulary lives in ONE
 * place: a surface the GitHub layer does not define cannot be labelled here.
 */
import { GitHubSurface } from '@/github/types';

const SURFACE_LABELS: Record<GitHubSurface, string> = {
  [GitHubSurface.Repository]: 'Repository',
  [GitHubSurface.File]: 'File',
  [GitHubSurface.Directory]: 'Directory',
  [GitHubSurface.Commit]: 'Commit',
  [GitHubSurface.PullRequest]: 'Pull request',
  [GitHubSurface.Issue]: 'Issue',
  [GitHubSurface.Discussion]: 'Discussion',
  [GitHubSurface.Release]: 'Release',
  [GitHubSurface.Search]: 'Search results',
  [GitHubSurface.Unknown]: 'Unknown',
};

/** Closed label lookup — never content-derived, never user-supplied. */
export function surfaceLabel(surface: GitHubSurface): string {
  return SURFACE_LABELS[surface] ?? 'Unknown';
}
