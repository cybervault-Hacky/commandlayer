/**
 * AI abstraction — contracts only, no providers in Phase 1.
 *
 * Future phases plug real providers behind this interface; the command
 * pipeline and UI never change. No API keys, no network calls, no hardcoded
 * endpoints exist anywhere in Phase 1.
 */
import type { PageContext } from '@/shared/types/page';

export type AIErrorCode =
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_INVALID_REQUEST'
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_ERROR';

export interface AIError {
  code: AIErrorCode;
  /** User-safe message. */
  message: string;
  retryable: boolean;
}

export interface AIOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AIRequest {
  id: string;
  prompt: string;
  context?: {
    page?: PageContext | null;
  };
  options?: AIOptions;
}

export interface AIResponse {
  id: string;
  provider: string;
  text: string;
  finishedAt: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  isAvailable(): boolean;
  complete(request: AIRequest): Promise<AIResponse | AIError>;
}

export function isAIError(value: AIResponse | AIError): value is AIError {
  return 'code' in value;
}
