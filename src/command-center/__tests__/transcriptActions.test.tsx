import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SessionTranscript,
  type TranscriptEntry,
} from '../components/SessionTranscript';
import type { CommandResult } from '@/shared/types/command';
import type { ActionExecutionResult, ActionPlan } from '@/actions/types';

const plan: ActionPlan = {
  planId: 'plan-t',
  requestId: 'req-t',
  tabId: 1,
  url: 'https://example.com/',
  contentHash: 'ctx',
  actions: [
    {
      stepId: 's1',
      action: { type: 'FIND_TEXT', query: 'pricing' },
      preview: 'Find text “pricing” (read-only)',
    },
  ],
  risk: 'READ_ONLY',
  requiresConfirmation: false,
  planHash: 'hash',
  createdAt: '2026-09-22T00:00:00.000Z',
  expiresAt: '2026-09-22T00:02:00.000Z',
};

const execution: ActionExecutionResult = {
  planId: 'plan-t',
  planHash: 'hash',
  status: 'completed',
  steps: [
    {
      actionId: 's1',
      kind: 'FIND_TEXT',
      status: 'success',
      message: 'Found 2 matches.',
      data: {
        kind: 'FIND_TEXT',
        matchCount: 2,
        matches: [
          { index: 1, snippet: 'Pricing starts free.' },
          { index: 2, snippet: 'See pricing details.' },
        ],
      },
      durationMs: 4,
    },
  ],
  summary: 'Completed 1 of 1 action.',
  startedAt: '2026-09-22T00:00:01.000Z',
  finishedAt: '2026-09-22T00:00:02.000Z',
};

function assistant(result: Partial<CommandResult>): TranscriptEntry {
  return {
    kind: 'assistant',
    id: `turn-${Math.random()}`,
    at: new Date().toISOString(),
    result: {
      id: 'req-t',
      status: 'completed',
      text: '',
      source: 'command-center',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...result,
    },
  };
}

describe('Session transcript — Phase 4 entries', () => {
  it('renders proposed plans inline as read-only previews (no buttons)', () => {
    render(
      <SessionTranscript
        entries={[assistant({ text: 'Proposed action', plan })]}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/Find text “pricing”/)).toBeInTheDocument();
    expect(screen.getByText(/Awaiting your approval/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
  });

  it('renders executed plans with their verified outcome', () => {
    render(
      <SessionTranscript
        entries={[assistant({ text: 'Done', plan, execution })]}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/Action result/i)).toBeInTheDocument();
    expect(screen.getByText(/Found 2 matches/)).toBeInTheDocument();
    expect(screen.getByText(/Pricing starts free/)).toBeInTheDocument();
    expect(screen.getByText(/Completed 1 of 1 action/)).toBeInTheDocument();
  });

  it('keeps reasoning answers in the classic AI response card', () => {
    render(
      <SessionTranscript
        entries={[
          assistant({
            text: 'An answer.',
            ai: {
              requestId: 'req-t',
              intent: 'ANSWER',
              status: 'success',
              answer: 'An answer.',
              sections: [],
              sources: [],
              provider: 'local-mock',
              finishedAt: new Date().toISOString(),
            },
          }),
        ]}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/An answer/)).toBeInTheDocument();
    expect(screen.queryByText(/Proposed action/i)).toBeNull();
    expect(screen.queryByText(/Action result/i)).toBeNull();
  });
});
