import type { AIError, AIProvider, AIRequest, AIResponse } from './types';

/**
 * Development/mock provider. It is the *only* provider in Phase 1 and it is
 * fully local: no network, no keys, no external calls. Its response is
 * explicitly honest about being a placeholder.
 *
 * The latency/failure seams below exist so tests can exercise the pipeline
 * deterministically.
 */
export const MOCK_RESPONSE_TEXT =
  'Command received.\n\nAI intelligence will be connected in a future phase.';

/** Used when the command pipeline received a real (engine-captured) page context. */
export const PAGE_CONTEXT_CAPTURED_TEXT =
  'Page context captured successfully.\n\nThe AI reasoning engine will be connected in a future phase.';

/** True when the request carries a context captured by the Page Intelligence Engine. */
export function requestHasPageIntelligence(request: AIRequest): boolean {
  const page = request.context?.page;
  if (!page) return false;
  if (page.state !== 'ready' && page.state !== 'partial') return false;
  return (
    page.headings.length > 0 ||
    page.paragraphs.length > 0 ||
    page.links.length > 0 ||
    page.tables.length > 0 ||
    page.forms.length > 0 ||
    page.selectedText !== null
  );
}

const MAX_PROMPT_LENGTH = 2000;

let mockLatencyMs = 420;
let mockFailure: AIError | null = null;

export function setMockProviderLatency(latencyMs: number): void {
  mockLatencyMs = Math.max(0, latencyMs);
}

export function setMockProviderFailure(failure: AIError | null): void {
  mockFailure = failure;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockAIProvider implements AIProvider {
  readonly id = 'local-mock';
  readonly displayName = 'Local mock provider';
  readonly version = '0.1.0';
  readonly capabilities: readonly string[] = ['local-command-ack'];

  isAvailable(): boolean {
    return true;
  }

  async complete(request: AIRequest): Promise<AIResponse | AIError> {
    const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
    if (prompt.length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
      return {
        code: 'AI_INVALID_REQUEST',
        message: 'The command prompt is empty or too long.',
        retryable: false,
      };
    }

    await delay(mockLatencyMs);

    if (mockFailure) return mockFailure;

    return {
      id: request.id,
      provider: this.id,
      // Honest, context-aware acknowledgement: never claims AI analysis ran.
      text: requestHasPageIntelligence(request)
        ? PAGE_CONTEXT_CAPTURED_TEXT
        : MOCK_RESPONSE_TEXT,
      finishedAt: new Date().toISOString(),
    };
  }
}
