export * from './types';
export { integrationRegistry } from './registry';
export * from './github';

/**
 * Phase 7 registers the GitHub integration. It reports page-context
 * availability only (reading the page the user has open); signed-in API
 * access stays disabled and is documented as such.
 */
import { integrationRegistry } from './registry';
import { githubIntegration } from './github';

integrationRegistry.register(githubIntegration);
