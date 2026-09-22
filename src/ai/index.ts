/**
 * Phase 3 — provider registry.
 *
 * Two providers exist:
 * - local-mock: deterministic, offline, zero-config default
 * - secure-gateway: HTTPS gateway adapter (active only when a valid
 *   gateway URL is configured; still requires no secrets in the extension)
 *
 * The UI never calls providers directly — requests go through the
 * client (client.ts), which adds validation, timeout, cancellation,
 * and response validation.
 */
import { gatewayAIProvider } from './providers/gatewayProvider';
import { mockAIProvider } from './mockProvider';
import type { AIProvider, AIStatusInfo } from './types';

export * from './types';
export { mockAIProvider } from './mockProvider';
export { gatewayAIProvider } from './providers/gatewayProvider';

const providers = new Map<string, AIProvider>();

export function registerAIProvider(provider: AIProvider): void {
  providers.set(provider.id, provider);
}

export function getAIProvider(id: string): AIProvider | undefined {
  return providers.get(id);
}

/**
 * Resolve the active provider: the gateway when configured and
 * available, otherwise the local mock (the extension must stay fully
 * functional with zero configuration).
 */
export function getActiveAIProvider(): AIProvider {
  const gateway = providers.get(gatewayAIProvider.id);
  if (gateway && gateway.isAvailable()) return gateway;
  const mock = providers.get(mockAIProvider.id);
  if (mock && mock.isAvailable()) return mock;
  // The mock is always available; this is defensive only.
  return mockAIProvider;
}

/** Non-secret provider status for the Settings UI. */
export function getAIStatusInfo(): AIStatusInfo {
  const gatewayConfigured =
    providers.has(gatewayAIProvider.id) && gatewayAIProvider.isAvailable();
  const active = getActiveAIProvider();
  return {
    providerId: active.id,
    providerLabel: active.displayName,
    mode: active.mode,
    gatewayConfigured,
  };
}

registerAIProvider(mockAIProvider);
registerAIProvider(gatewayAIProvider);
