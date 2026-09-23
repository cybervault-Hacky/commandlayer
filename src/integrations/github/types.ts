/**
 * Phase 7 — GitHub integration boundary: types.
 *
 * CommandLayer reads GitHub the way it reads every other page: through the
 * page the user is already viewing. That is "Mode A" (page context) and it
 * needs no account, no token, and no API call.
 *
 * "Mode B" (authenticated GitHub API access) is deliberately NOT implemented
 * in this version. The types below define the boundary so that a future
 * implementation has to answer the security questions explicitly, but there
 * is no client, no OAuth flow, no token storage, and no way to enable it.
 * Nothing here can fake authentication.
 */

/** How GitHub information is obtained. */
export const GitHubIntegrationMode = {
  /** Read the page the user is viewing. No account, no network. */
  PageContext: 'page_context',
  /** Authenticated API access. NOT implemented in this version. */
  Authenticated: 'authenticated',
} as const;

export type GitHubIntegrationMode =
  (typeof GitHubIntegrationMode)[keyof typeof GitHubIntegrationMode];

export interface GitHubIntegrationStatus {
  /** The mode actually in use right now. */
  mode: GitHubIntegrationMode;
  /** True when the page-context mode can read the current page. */
  pageContextAvailable: boolean;
  /** Always false in this version — see README + docs/github-integration.md. */
  authenticatedAvailable: false;
  /** User-safe explanation, shown in Settings and the docs. */
  detail: string;
}

/**
 * A typed API request shape for the (unimplemented) authenticated mode.
 * It exists so the boundary is visible and testable: no code constructs one,
 * and no code may act on one.
 */
export interface GitHubApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Repository-relative API path, e.g. `/repos/owner/name/pulls/12`. */
  path: string;
  /** Query parameters (strings only). */
  query?: Record<string, string>;
}

export interface GitHubApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
}
