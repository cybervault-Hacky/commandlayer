/**
 * Phase 7 — GitHub integration errors.
 *
 * Every code has one fixed, user-safe message. Provider internals, HTTP
 * details, and credential state are never forwarded to the UI.
 */
export const GitHubIntegrationErrorCode = {
  /** The authenticated mode is not implemented and cannot be enabled. */
  GITHUB_AUTH_DISABLED: 'GITHUB_AUTH_DISABLED',
  /** No repository context is available for the current page. */
  GITHUB_NO_CONTEXT: 'GITHUB_NO_CONTEXT',
  /** The requested target is not a supported GitHub location. */
  GITHUB_TARGET_UNSUPPORTED: 'GITHUB_TARGET_UNSUPPORTED',
  /** A payload failed structural validation. */
  GITHUB_INVALID_PAYLOAD: 'GITHUB_INVALID_PAYLOAD',
} as const;

export type GitHubIntegrationErrorCode =
  (typeof GitHubIntegrationErrorCode)[keyof typeof GitHubIntegrationErrorCode];

export const GITHUB_INTEGRATION_MESSAGES: Record<
  GitHubIntegrationErrorCode,
  string
> = {
  [GitHubIntegrationErrorCode.GITHUB_AUTH_DISABLED]:
    'CommandLayer reads GitHub only from the page you have open. Signed-in GitHub API access is not available in this version.',
  [GitHubIntegrationErrorCode.GITHUB_NO_CONTEXT]:
    'This page does not expose repository context, so no GitHub information could be read.',
  [GitHubIntegrationErrorCode.GITHUB_TARGET_UNSUPPORTED]:
    'That is not a supported GitHub location.',
  [GitHubIntegrationErrorCode.GITHUB_INVALID_PAYLOAD]:
    'That GitHub request could not be validated.',
};

export interface GitHubIntegrationError {
  code: GitHubIntegrationErrorCode;
  message: string;
}

export function gitHubIntegrationError(
  code: GitHubIntegrationErrorCode,
): GitHubIntegrationError {
  return { code, message: GITHUB_INTEGRATION_MESSAGES[code] };
}
