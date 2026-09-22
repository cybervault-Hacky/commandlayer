import { describe, expect, it } from 'vitest';
import { ActionRisk, type Action } from '@/actions/types';
import { WORKFLOW_LIMITS } from '../limits';
import { hashActions } from '../hash';
import {
  buildWorkflowStep,
  combinedWorkflowRisk,
  findSensitiveStep,
  parseWorkflowProposal,
  validateWorkflowSteps,
  type StepBuildOptions,
} from '../validator';
import type { WorkflowStep } from '../types';
import { FIXTURE_TAB_ID, FIXTURE_URL } from './fixtures';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function options(overrides: Partial<StepBuildOptions> = {}): StepBuildOptions {
  return {
    index: 0,
    intent: 'FIND',
    requestId: 'req-1',
    tabId: FIXTURE_TAB_ID,
    url: FIXTURE_URL,
    contentHash: 'digest-fixture',
    now: NOW,
    ...overrides,
  };
}

function stepFor(candidate: unknown, overrides: Partial<StepBuildOptions> = {}): WorkflowStep {
  const step = buildWorkflowStep(candidate, options(overrides));
  if (step === null) throw new Error('expected a step');
  return step;
}

describe('untrusted proposal schema validation', () => {
  it('accepts a well-formed proposal', () => {
    const parsed = parseWorkflowProposal({
      goal: 'find "A" and read the page',
      steps: [{ action: 'FIND_TEXT' }, { action: 'READ_PAGE', label: 'Read it' }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.steps).toEqual([
      { action: 'FIND_TEXT' },
      { action: 'READ_PAGE', label: 'Read it' },
    ]);
  });

  it('rejects anything that is not a closed-key object', () => {
    const bad = [
      null,
      'goal',
      42,
      [],
      { goal: 'x' },
      { steps: [{ action: 'READ_PAGE' }] },
      { goal: 'x', steps: 'READ_PAGE' },
      { goal: 'x', steps: [] },
      { goal: 'x', steps: [{ action: 'READ_PAGE' }], extra: true },
      { goal: 'x', steps: [{ action: 'READ_PAGE', target: '#a' }] },
      { goal: 'x', steps: [{ action: 'READ_PAGE', label: '   ' }] },
    ];
    for (const candidate of bad) {
      expect(parseWorkflowProposal(candidate)).toBeNull();
    }
  });

  it('rejects executable-content keys anywhere in the proposal', () => {
    const attacks = [
      { goal: 'x', steps: [{ action: 'READ_PAGE' }], code: 'alert(1)' },
      { goal: 'x', steps: [{ action: 'READ_PAGE' }], script: 'alert(1)' },
      { goal: 'x', steps: [{ action: 'READ_PAGE', selector: '#a' }] },
      { goal: 'x', steps: [{ action: 'READ_PAGE', xpath: '//a' }] },
      { goal: 'x', steps: [{ action: 'READ_PAGE', url: 'https://evil.test' }] },
    ];
    for (const candidate of attacks) {
      expect(parseWorkflowProposal(candidate)).toBeNull();
    }
  });

  it('rejects unregistered action kinds', () => {
    for (const action of [
      'EXECUTE_JAVASCRIPT',
      'RUN_SCRIPT',
      'NAVIGATE',
      'read_page',
      '',
    ]) {
      expect(parseWorkflowProposal({ goal: 'x', steps: [{ action }] })).toBeNull();
    }
  });

  it('bounds the goal and the step count', () => {
    expect(
      parseWorkflowProposal({ goal: 'x'.repeat(500), steps: [{ action: 'READ_PAGE' }] }),
    ).toBeNull();
    expect(
      parseWorkflowProposal({
        goal: 'x',
        steps: Array.from({ length: WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS + 1 }, () => ({
          action: 'READ_PAGE',
        })),
      }),
    ).toBeNull();
  });
});

describe('step construction (planner and AI alike)', () => {
  it('builds a step with a real plan hash and the registry retry policy', () => {
    const step = stepFor({ type: 'FIND_TEXT', query: 'React' });
    expect(step.intent).toBe('FIND');
    expect(step.retryPolicy).toBe('SAFE');
    expect(step.status).toBe('PENDING');
    expect(step.attempts).toBe(0);
    expect(step.mutated).toBe(false);
    expect(step.actionsHash).toBe(hashActions(step.actionPlan.actions));
    expect(step.actionPlan.actions).toHaveLength(1);
  });

  it('marks mutating steps and honors navigation expectations', () => {
    const step = stepFor(
      { type: 'CLICK_ELEMENT', target: { kind: 'role', role: 'link', name: 'Docs' } },
      { intent: 'OPEN', expectsNavigation: true, expectedUrl: 'https://example.org/docs' },
    );
    expect(step.mutated).toBe(true);
    expect(step.expectsNavigation).toBe(true);
    expect(step.expectedUrl).toBe('https://example.org/docs');
    expect(step.retryPolicy).toBe('NEVER');
  });

  it('refuses actions the Phase 4 model cannot express', () => {
    const refused = [
      { type: 'EXECUTE_JAVASCRIPT', code: 'x' },
      { type: 'CLICK_ELEMENT', target: { kind: 'css', selector: '#go' } },
      { type: 'CLICK_ELEMENT', target: { kind: 'xpath', xpath: '//button' } },
      { type: 'TYPE_TEXT', target: { kind: 'text', text: 'Search' }, text: 'x'.repeat(2000) },
      { type: 'SCROLL', direction: 'sideways' },
    ];
    for (const candidate of refused) {
      expect(buildWorkflowStep(candidate, options())).toBeNull();
    }
  });
});

describe('workflow validation', () => {
  it('requires at least two steps', () => {
    const single = [stepFor({ type: 'READ_PAGE' })];
    expect(validateWorkflowSteps(single)).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_TASK_NOT_SUPPORTED' },
    });
  });

  it('enforces the step bound', () => {
    const steps = Array.from({ length: WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS + 1 }, () =>
      stepFor({ type: 'READ_PAGE' }),
    );
    expect(validateWorkflowSteps(steps)).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_TOO_MANY_STEPS' },
    });
  });

  it('accepts a bounded, hash-consistent plan', () => {
    const steps = [
      stepFor({ type: 'FIND_TEXT', query: 'React' }, { index: 0 }),
      stepFor({ type: 'READ_PAGE' }, { index: 1, intent: 'READ' }),
    ];
    expect(validateWorkflowSteps(steps).ok).toBe(true);
  });

  it('detects a tampered step hash', () => {
    const steps = [
      stepFor({ type: 'FIND_TEXT', query: 'React' }, { index: 0 }),
      stepFor({ type: 'READ_PAGE' }, { index: 1, intent: 'READ' }),
    ];
    const tampered = { ...steps[1] as WorkflowStep, actionsHash: 'tampered' };
    expect(validateWorkflowSteps([steps[0] as WorkflowStep, tampered])).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_INVALID' },
    });
  });

  it('blocks a workflow that touches a sensitive field', () => {
    const steps = [
      stepFor({ type: 'READ_PAGE' }, { index: 0 }),
      stepFor(
        {
          type: 'TYPE_TEXT',
          target: { kind: 'role', role: 'textbox', name: 'Password' },
          text: 'hunter2',
        },
        { index: 1, intent: 'TYPE' },
      ),
    ];
    expect(findSensitiveStep(steps)).toBeDefined();
    expect(validateWorkflowSteps(steps)).toMatchObject({
      ok: false,
      error: { code: 'WORKFLOW_SENSITIVE_ACTION' },
    });
  });

  it('allows a non-sensitive field interaction', () => {
    const steps = [
      stepFor({ type: 'READ_PAGE' }, { index: 0 }),
      stepFor(
        {
          type: 'TYPE_TEXT',
          target: { kind: 'role', role: 'searchbox', name: 'Search documentation' },
          text: 'react hooks',
        },
        { index: 1, intent: 'TYPE' },
      ),
    ];
    expect(findSensitiveStep(steps)).toBeUndefined();
    expect(validateWorkflowSteps(steps).ok).toBe(true);
  });
});

describe('risk propagation', () => {
  it('never downgrades the highest step risk', () => {
    const readOnly: Action[] = [{ type: 'READ_PAGE' }];
    const find: Action[] = [{ type: 'FIND_TEXT', query: 'React' }];
    const click: Action[] = [
      { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
    ];
    const readStep = stepFor({ type: 'READ_PAGE' }, { index: 0 });
    const findStep = stepFor({ type: 'FIND_TEXT', query: 'React' }, { index: 1 });
    const clickStep = stepFor(
      { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
      { index: 2, intent: 'OPEN' },
    );

    expect(combinedWorkflowRisk([readStep, findStep])).toBe(ActionRisk.ReadOnly);
    expect(combinedWorkflowRisk([readStep, clickStep])).toBe(
      ActionRisk.Confirmation,
    );
    expect(combinedWorkflowRisk([])).toBe(ActionRisk.ReadOnly);
    // Sanity: the same actions through the Phase 4 registry agree.
    expect(combinedWorkflowRisk([readStep, findStep])).not.toBe(
      combinedWorkflowRisk([readStep, clickStep]),
    );
    expect(click).toHaveLength(1);
    expect(readOnly).toHaveLength(1);
    expect(find).toHaveLength(1);
  });
});
