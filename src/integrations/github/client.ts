/**
 * Phase 7 — GitHub integration client.
 *
 * THERE IS NO NETWORK CODE HERE. Mode A (page context) does not need one:
 * the GitHub information CommandLayer uses always comes from the page the
 * user is already viewing, captured by the extension's own page-intelligence
 * engine and validated at the trust boundary.
 *
 * Mode B (authenticated) is disabled by construction:
 *  - `getGitHubIntegrationStatus()` always reports `authenticatedAvailable: false`
 *  - `isAuthenticatedModeAvailable()` is a literal `false`
 *  - `requestGitHubApi()` validates its input and then refuses, whatever the
 *    input was — it cannot succeed, and it holds no credentials
 *  - there is no token parameter, no storage key, and no localStorage or
 *    Vite environment access anywhere in this module
 *
 * Enabling it would require a dedicated security architecture (see
 * docs/github-integration.md). Until then, honesty over convenience.
 */
import {
  GitHubIntegrationErrorCode,
  gitHubIntegrationError,
  type GitHubIntegrationError,
} from './errors';
import type {
  GitHubApiResponse,
  GitHubIntegrationStatus,
} from './types';
import { GitHubIntegrationMode } from './types';
import { parseApiRequest, type ValidationOutcome } from './validators';

const PAGE_CONTEXT_DETAIL =
  'CommandLayer reads GitHub from the page you have open: the repository, file, diff, and issue structure that GitHub itself rendered. Nothing is fetched from the GitHub API, and no account is used.';

/** The current integration state. Deterministic, no I/O. */
export function getGitHubIntegrationStatus(
  pageContextAvailable = false,
): GitHubIntegrationStatus {
  return {
    mode: GitHubIntegrationMode.PageContext,
    pageContextAvailable,
    authenticatedAvailable: false,
    detail: PAGE_CONTEXT_DETAIL,
  };
}

/** Signed-in GitHub access is not implemented — and cannot be turned on. */
export function isAuthenticatedModeAvailable(): false {
  return false;
}

/**
 * The authenticated API is not implemented. This function exists so the
 * boundary is explicit and testable: it validates the request shape (a
 * malformed or credential-bearing request is rejected as such) and then
 * refuses with GITHUB_AUTH_DISABLED. It never performs I/O.
 */
export async function requestGitHubApi(
  request: unknown,
): Promise<
  | ValidationOutcome<GitHubApiResponse>
  | { ok: false; error: GitHubIntegrationError }
> {
  const parsed = parseApiRequest(request);
  if (!parsed.ok) return parsed;
  return {
    ok: false,
    error: gitHubIntegrationError(GitHubIntegrationErrorCode.GITHUB_AUTH_DISABLED),
  };
}
