/**
 * Phase 3 — production provider adapter: routes reasoning through the
 * Secure Intelligence Gateway (HTTPS). The extension itself stores no
 * provider secret; only the gateway URL is configured.
 */
import { buildPrompt } from '../prompts';
import {
  callReasonEndpoint,
  getGatewayUrlFromEnv,
  isValidGatewayUrl,
} from '../gateway';
import type {
  AIProvider,
  AIRequest,
  AIResponseCandidate,
  AIError,
} from '../types';

const GATEWAY_PROVIDER_ID = 'secure-gateway';
const GATEWAY_PROVIDER_LABEL = 'Secure gateway';
const GATEWAY_VERSION = '1.0.0';

class GatewayAIProvider implements AIProvider {
  readonly id = GATEWAY_PROVIDER_ID;
  readonly displayName = GATEWAY_PROVIDER_LABEL;
  readonly version = GATEWAY_VERSION;
  readonly mode = 'gateway' as const;

  /** The gateway is usable only when a valid gateway URL is configured. */
  isAvailable(): boolean {
    return isValidGatewayUrl(getGatewayUrlFromEnv());
  }

  async generate(
    request: AIRequest,
    signal: AbortSignal,
  ): Promise<AIResponseCandidate | AIError> {
    const baseUrl = getGatewayUrlFromEnv();
    let built;
    try {
      built = buildPrompt(request);
    } catch {
      // Prompt building throws only for invalid user prompts.
      return {
        code: 'AI_INVALID_REQUEST',
        message: 'That request could not be understood. Please rephrase it.',
        retryable: false,
      };
    }
    return callReasonEndpoint({
      baseUrl: baseUrl ?? '',
      signal,
      request: {
        requestId: request.requestId,
        intent: request.intent,
        system: built.system,
        prompt: built.prompt,
        context: request.context,
      },
    });
  }
}

/** Single shared gateway provider instance. */
export const gatewayAIProvider: AIProvider = new GatewayAIProvider();
