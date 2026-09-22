import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionPreviewCard } from '../ActionPreviewCard';
import { ActionProgressCard } from '../ActionProgressCard';
import type { ActionExecutionResult, ActionPlan } from '@/actions/types';

const plan: ActionPlan = {
  planId: 'plan-1',
  requestId: 'req-1',
  tabId: 1,
  url: 'https://example.com/',
  contentHash: 'ctx',
  actions: [
    {
      stepId: 's1',
      action: { type: 'SCROLL', direction: 'down', distancePx: 400 },
      preview: 'Scroll down 400px',
    },
    {
      stepId: 's2',
      action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Save' } },
      preview: 'Click “Save”',
    },
  ],
  risk: 'CONFIRMATION_REQUIRED',
  requiresConfirmation: true,
  planHash: 'hash',
  createdAt: '2026-09-22T00:00:00.000Z',
  expiresAt: '2026-09-22T00:02:00.000Z',
};

describe('ActionPreviewCard', () => {
  it('renders every step, the risk badge, and decision buttons', () => {
    render(
      <ActionPreviewCard plan={plan} onApprove={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText(/Scroll down 400px/)).toBeInTheDocument();
    expect(screen.getByText(/Click “Save”/)).toBeInTheDocument();
    expect(screen.getByText('Requires confirmation')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /allow & run 2 actions/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('focuses the approve button on mount (keyboard-first approval)', () => {
    render(
      <ActionPreviewCard plan={plan} onApprove={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /allow/i })).toHaveFocus();
  });

  it('calls onApprove exactly once per click', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<ActionPreviewCard plan={plan} onApprove={onApprove} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /allow/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('cancels via the Cancel button and via Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ActionPreviewCard plan={plan} onApprove={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    onCancel.mockClear();
    screen.getByRole('button', { name: /allow/i }).focus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('readOnly mode shows no decision buttons', () => {
    render(
      <ActionPreviewCard
        plan={plan}
        onApprove={() => {}}
        onCancel={() => {}}
        readOnly
      />,
    );
    expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.getByText(/awaiting your approval/i)).toBeInTheDocument();
  });
});

describe('ActionProgressCard', () => {
  const execution: ActionExecutionResult = {
    planId: 'plan-1',
    planHash: 'hash',
    status: 'completed',
    steps: [
      {
        actionId: 's1',
        kind: 'SCROLL',
        status: 'success',
        message: 'Scrolled 400px down.',
        verification: { ok: true, detail: 'Position changed by 400px' },
        durationMs: 3,
      },
      {
        actionId: 's2',
        kind: 'CLICK_ELEMENT',
        status: 'success',
        message: 'Clicked button.',
        verification: { ok: true, detail: 'Click dispatched on the revalidated target.' },
        durationMs: 5,
      },
    ],
    summary: 'Completed 2 of 2 actions.',
    startedAt: '2026-09-22T00:00:01.000Z',
    finishedAt: '2026-09-22T00:00:02.000Z',
  };

  it('renders executed steps with verification details (boolean/state only)', () => {
    render(<ActionProgressCard plan={plan} execution={execution} />);
    expect(screen.getByText(/Scroll down 400px/)).toBeInTheDocument();
    expect(screen.getByText(/Position changed by 400px/)).toBeInTheDocument();
    expect(screen.getByText(/Completed 2 of 2 actions/)).toBeInTheDocument();
  });

  it('shows pending and running states while executing', () => {
    render(<ActionProgressCard plan={plan} execution={null} running />);
    expect(screen.getByText(/Running action/i)).toBeInTheDocument();
    expect(screen.getByText(/Executing…/)).toBeInTheDocument();
  });

  it('never echoes typed values from step messages', () => {
    const blocked: ActionExecutionResult = {
      ...execution,
      status: 'blocked',
      steps: [
        {
          actionId: 's1',
          kind: 'TYPE_TEXT',
          status: 'blocked',
          message: 'CommandLayer never types into sensitive fields such as passwords or payment details.',
          durationMs: 2,
        },
      ],
      stoppedAt: 0,
      summary: 'Stopped before completing: “Type into “Password”” was blocked. Nothing after it ran.',
    };
    const { container } = render(<ActionProgressCard plan={null} execution={blocked} />);
    expect(container.textContent).toContain('never types into sensitive');
    expect(container.textContent).not.toContain('hunter2');
  });
});
