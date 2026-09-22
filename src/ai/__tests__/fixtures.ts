/**
 * Shared fixtures for Phase 3 AI tests. All content is deterministic and
 * inert; nothing here touches the network.
 */
import type { AIContext, AIRequest, AIIntent } from '../types';

export function makeAIContext(overrides: Partial<AIContext> = {}): AIContext {
  return {
    page: {
      title: 'Climate Report 2026',
      url: 'https://example.org/climate',
      hostname: 'example.org',
      language: 'en',
      description: 'Annual climate overview',
    },
    headings: [
      { level: 1, text: 'Climate Report 2026' },
      { level: 2, text: 'Emissions' },
      { level: 2, text: 'Outlook' },
    ],
    text:
      'Global emissions plateaued in 2025. Renewable capacity grew quickly.\n\n' +
      'The outlook remains sensitive to policy decisions.',
    links: [
      {
        text: 'Methodology',
        url: 'https://example.org/method',
        hostname: 'example.org',
      },
    ],
    tables: [],
    selectedText: null,
    truncated: false,
    ...overrides,
  };
}

export function makeAIRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    requestId: 'req-1',
    intent: 'SUMMARIZE',
    userPrompt: 'Summarize this page',
    context: makeAIContext(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function alwaysAborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

export function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

export type { AIIntent };
