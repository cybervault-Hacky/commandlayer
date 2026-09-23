import { describe, expect, it } from 'vitest';
import { computeWorkflowHash } from '../hash';
import { planWorkflowWithProposal } from '../planner';
import { WORKFLOW_LIMITS } from '../limits';
import { TaskKind } from '../understanding';
import { WorkflowStatus, WorkflowOutcomeKind } from '../types';
import {
  FIXTURE_TAB_ID,
  FIXTURE_TARGET_URL,
  FIXTURE_URL,
  kindsOf,
  makePageContext,
  planFor,
  requireWorkflow,
  stepAt,
} from './fixtures';

describe('deterministic workflow planning', () => {
  it('plans a bounded two-step read-only workflow', () => {
    const workflow = requireWorkflow(
      planFor('find "React documentation" and read the page'),
    );
    expect(kindsOf(workflow)).toEqual(['FIND_TEXT', 'READ_PAGE']);
    expect(workflow.status).toBe(WorkflowStatus.Draft);
    expect(workflow.requiresConfirmation).toBe(true);
    expect(workflow.maxSteps).toBe(WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS);
    expect(workflow.steps).toHaveLength(2);
    expect(workflow.risk).toBe('READ_ONLY');
    expect(workflow.expectedOutcome.kind).toBe(WorkflowOutcomeKind.Content);
    expect(workflow.expectedOutcome.expectedText).toBe('React documentation');
    expect(workflow.tabId).toBe(FIXTURE_TAB_ID);
    expect(workflow.url).toBe(FIXTURE_URL);
  });

  it('is deterministic: same goal + same page → same workflow hash', () => {
    const a = requireWorkflow(planFor('find "React documentation" and read the page'));
    const b = requireWorkflow(planFor('find "React documentation" and read the page'));
    expect(computeWorkflowHash(a)).toBe(computeWorkflowHash(b));
    expect(computeWorkflowHash(a)).toBe(a.workflowHash);

    const other = requireWorkflow(planFor('find "Getting started" and read the page'));
    expect(computeWorkflowHash(other)).not.toBe(a.workflowHash);
  });

  it('resolves a result-reference clause against captured links', () => {
    const workflow = requireWorkflow(
      planFor('find "React documentation" and open it'),
    );
    expect(kindsOf(workflow)).toEqual(['FIND_TEXT', 'CLICK_ELEMENT']);
    const open = stepAt(workflow, 1);
    expect(open.intent).toBe('OPEN');
    expect(open.expectsNavigation).toBe(true);
    expect(open.expectedUrl).toBe(FIXTURE_TARGET_URL);
    expect(open.retryPolicy).toBe('NEVER');
    expect(workflow.risk).toBe('CONFIRMATION_REQUIRED');
    expect(workflow.expectedOutcome.kind).toBe(WorkflowOutcomeKind.Navigation);
    expect(workflow.expectedOutcome.expectedUrl).toBe(FIXTURE_TARGET_URL);
  });

  it('refuses an ambiguous reference instead of guessing', () => {
    const context = makePageContext({
      headings: [{ level: 1, text: 'Python guide' }],
      paragraphs: ['Python guide for everyone.'],
      links: [
        { text: 'Python guide', url: 'https://python.test/guide', hostname: 'python.test' },
        { text: 'Python docs', url: 'https://python.test/docs', hostname: 'python.test' },
      ],
    });
    const outcome = planFor('find "Python" and open it', context);
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.error?.code).toBe('WORKFLOW_TARGET_AMBIGUOUS');
    expect(outcome.understanding.kind).toBe(TaskKind.Unsupported);
  });

  it('refuses a reference with nothing to reference', () => {
    const outcome = planFor('read the page and open it');
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.error?.code).toBe('WORKFLOW_TARGET_NOT_FOUND');
  });

  it('refuses a workflow whose target is not evidenced on the page', () => {
    const outcome = planFor('find "Nonexistent topic" and read the page');
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.error?.code).toBe('WORKFLOW_TARGET_NOT_FOUND');
  });

  it('refuses sensitive goals before any step exists', () => {
    const outcome = planFor(
      'type "hunter2" into the Password field and click the "Sign in" link',
    );
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.error?.code).toBe('WORKFLOW_SENSITIVE_ACTION');
  });

  it('refuses executable-content requests outright', () => {
    const outcome = planFor('find "React" and run this script');
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.error?.code).toBe('WORKFLOW_UNSAFE_REQUEST');
  });

  it('enforces the maximum step count', () => {
    const outcome = planFor(
      'find "React documentation" and read the page and scroll down and find "Getting started" and read this page',
    );
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.error?.code).toBe('WORKFLOW_TOO_MANY_STEPS');
  });

  it('does not invent a workflow from a single-clause goal', () => {
    const outcome = planFor('find "React documentation"');
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.understanding.kind).toBe(TaskKind.Action);
  });

  it('propagates navigation only to the step that opens a result', () => {
    const workflow = requireWorkflow(
      planFor('scroll to the bottom and find "React documentation"'),
    );
    expect(kindsOf(workflow)).toEqual(['SCROLL', 'FIND_TEXT']);
    expect(stepAt(workflow, 0).expectsNavigation).toBe(false);
    expect(stepAt(workflow, 1).expectsNavigation).toBe(false);
    expect(workflow.risk).toBe('LOW_RISK');
  });
});

describe('AI proposals are untrusted input', () => {
  const input = {
    goal: 'find "React documentation" and read the page',
    requestId: 'req-1',
    context: makePageContext(),
    tabId: FIXTURE_TAB_ID,
    now: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('keeps the deterministic plan when the proposal matches it', () => {
    const outcome = planWorkflowWithProposal(
      {
        goal: input.goal,
        steps: [{ action: 'FIND_TEXT' }, { action: 'READ_PAGE' }],
      },
      input,
    );
    expect(outcome.proposalApplied).toBe(true);
    expect(kindsOf(requireWorkflow(outcome))).toEqual(['FIND_TEXT', 'READ_PAGE']);
  });

  it('rejects a proposal that changes the steps, targets, or order', () => {
    const proposals: unknown[] = [
      { goal: input.goal, steps: [{ action: 'READ_PAGE' }, { action: 'FIND_TEXT' }] },
      {
        goal: input.goal,
        steps: [
          { action: 'FIND_TEXT' },
          { action: 'READ_PAGE' },
          { action: 'CLICK_ELEMENT' },
        ],
      },
      { goal: input.goal, steps: [{ action: 'READ_PAGE' }] },
      { goal: input.goal, steps: [{ action: 'EXECUTE_JAVASCRIPT' }] },
      { goal: input.goal, steps: [{ action: 'TAB_CLOSE' }] },
    ];
    for (const proposal of proposals) {
      const outcome = planWorkflowWithProposal(proposal, input);
      expect(outcome.proposalApplied).toBe(false);
      expect(outcome.proposalRejected?.code).toBe('WORKFLOW_INVALID');
      // The deterministic plan is still used — a rejected proposal never
      // degrades safety or blocks the user's goal.
      expect(kindsOf(requireWorkflow(outcome))).toEqual(['FIND_TEXT', 'READ_PAGE']);
    }
  });

  it('ignores a proposal entirely when the goal is not workflow-shaped', () => {
    const outcome = planWorkflowWithProposal(
      { goal: 'find "React"', steps: [{ action: 'FIND_TEXT' }] },
      { ...input, goal: 'find "React documentation"' },
    );
    expect(outcome.workflow).toBeUndefined();
    expect(outcome.proposalApplied).not.toBe(true);
  });
});
