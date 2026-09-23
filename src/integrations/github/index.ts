/**
 * Phase 7 — GitHub integration.
 *
 * Mode A (page context) is what this build uses: CommandLayer reads the
 * GitHub structure of the page the user is already viewing, through its own
 * page-intelligence engine. Mode B (authenticated API) is present as a typed
 * boundary only, permanently disabled, and documented in
 * docs/github-integration.md — there is no OAuth flow, no token storage, and
 * no network client anywhere in this module.
 */
export * from './types';
export * from './errors';
export {
  containsCredentialMaterial,
  parseApiRequest,
  parseIntegrationStatus,
  type ValidationOutcome,
} from './validators';
export {
  getGitHubIntegrationStatus,
  isAuthenticatedModeAvailable,
  requestGitHubApi,
} from './client';
export {
  describeGitHubIntegration,
  githubRepositoryReference,
  type GitHubRepositoryReference,
} from './adapter';

import type { Integration } from '../types';
import { getGitHubIntegrationStatus } from './client';

/**
 * Registry entry for the integration architecture. `status()` reports the
 * page-context mode only: it is 'available' because reading the page you
 * have open needs no account, and it never claims a connection.
 */
export const githubIntegration: Integration = {
  id: 'github',
  name: 'GitHub',
  kind: 'service',
  status: () => (getGitHubIntegrationStatus(true).pageContextAvailable ? 'available' : 'unavailable'),
};
