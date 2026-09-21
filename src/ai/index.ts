import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { CommandLayerError } from '@/shared/security/errors';
import { MockAIProvider } from './mockProvider';
import type { AIProvider } from './types';

export * from './types';
export { MockAIProvider, MOCK_RESPONSE_TEXT } from './mockProvider';

const providers = new Map<string, AIProvider>();

/** Register a provider (future phases register real ones here). */
export function registerAIProvider(provider: AIProvider): void {
  providers.set(provider.id, provider);
}

export function getAIProvider(id: string): AIProvider | undefined {
  return providers.get(id);
}

export const DEFAULT_AI_PROVIDER_ID = 'local-mock';

/**
 * Resolve the active provider. Phase 1 registers only the local mock, so the
 * extension keeps working with zero external dependencies.
 */
export function getActiveAIProvider(): AIProvider {
  const provider = providers.get(DEFAULT_AI_PROVIDER_ID);
  if (!provider || !provider.isAvailable()) {
    throw new CommandLayerError(
      ErrorCode.AI_UNAVAILABLE,
      USER_ERROR_MESSAGES[ErrorCode.AI_UNAVAILABLE],
    );
  }
  return provider;
}

// Phase 1: local mock only.
registerAIProvider(new MockAIProvider());
