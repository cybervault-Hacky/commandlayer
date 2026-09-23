/**
 * Phase 7 — adapter between the validated GitHub page context and the rest of
 * CommandLayer.
 *
 * The adapter is intentionally thin: the developer layer owns repository
 * understanding, and this module only exposes the identity facts a caller
 * outside that layer legitimately needs (a slug for labels, a status line for
 * Settings). It reads nothing, fetches nothing, and holds no state.
 */
import { repositorySlug, type GitHubPageContext } from '@/github/types';
import type { GitHubIntegrationStatus } from './types';

export interface GitHubRepositoryReference {
  owner: string;
  repository: string;
  slug: string;
}

/** The repository identity of a validated page context, or null. */
export function githubRepositoryReference(
  github: GitHubPageContext | null,
): GitHubRepositoryReference | null {
  if (!github || !github.owner || !github.repository) return null;
  const slug = repositorySlug(github);
  if (slug === null) return null;
  return { owner: github.owner, repository: github.repository, slug };
}

/** One user-safe line describing what GitHub information is available. */
export function describeGitHubIntegration(
  status: GitHubIntegrationStatus,
  github: GitHubPageContext | null,
): string {
  const reference = githubRepositoryReference(github);
  if (!status.pageContextAvailable || reference === null) {
    return 'No GitHub repository context on this page.';
  }
  return `Reading ${reference.slug} from the page you have open. Signed-in GitHub access is not available in this version.`;
}
