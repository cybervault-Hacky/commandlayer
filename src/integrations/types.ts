/**
 * Integration architecture — Phase 1 holds types and an empty registry.
 *
 * Future phases (GitHub, Gmail, Slack, Notion, Jira, ...) will register
 * integrations here. No OAuth flows, tokens, or network clients exist in
 * Phase 1 by design.
 */

export type IntegrationKind = 'provider' | 'service' | 'storage';

export type IntegrationStatus = 'unavailable' | 'available' | 'connected';

export interface Integration {
  readonly id: string;
  readonly name: string;
  readonly kind: IntegrationKind;
  /** Whether the integration's features are reachable in this build. */
  status(): IntegrationStatus;
}
