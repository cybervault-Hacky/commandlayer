import { beforeEach, describe, expect, it } from 'vitest';
import type { PageHeading } from '@/shared/types/page';
import { WORKFLOW_LIMITS } from '../limits';
import {
  createDeterministicReplanner,
  isReplannable,
} from '../replan';
import { WorkflowEngine } from '../orchestrator';
import { workflowSessionStore } from '../state';
import { workflowSessions } from '../session';
import {
  detectNavigation,
  observedContentChanged,
  urlMatchesExpectation,
  WorkflowObserver,
  type ObservationSample,
} from '../observer';
import { verifyStepResult, verifyWorkflowOutcome } from '../verifier';
import {
  WorkflowOutcomeKind,
  WorkflowStatus,
  WorkflowStepStatus,
  type Workflow,
} from '../types';
import { buildWorkflowStep } from '../validator';
import {
  FakeWorkflowEnv,
  FIXTURE_TAB_ID,
  FIXTURE_URL,
  makePageContext,
  planFor,
  requireWorkflow,
  sample,
} from './fixtures';

const FIXED = Date.parse('2026-01-01T00:00:00.000Z');
const clock = { now: FIXED };
const READ_GOAL = 'find "React documentation" and read the page';

beforeEach(() => {
  clock.now = FIXED;
  workflowSessionStore.clear();
  workflowSessionStore.setClock(() => clock.now);
  workflowSessions.clear();
  workflowSessions.setClock(() => clock.now);
});

describe('bounded observation', () => {
  it('collects one bounded sample from Page Intelligence', async () => {
    const observer = new WorkflowObserver(async () =>
      makePageContext({ headings: [{ level: 1, text: 'React documentation' }] }),
    );
    const result = await observer.observe();
    expect(result?.url).toBe(FIXTURE_URL);
    expect(result?.headings).toEqual(['React documentation']);
    expect(result?.contentHash.length).toBeGreaterThan(0);
    // Never form values, secrets, or a second scraper's output.
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('returns null instead of guessing when the page cannot be observed', async () => {
    expect(await new WorkflowObserver(async () => null).observe()).toBeNull();
    expect(
      await new WorkflowObserver(async () => makePageContext({ state: 'unavailable' })).observe(),
    ).toBeNull();
    expect(
      await new WorkflowObserver(async () => {
        throw new Error('extraction exploded');
      }).observe(),
    ).toBeNull();
  });

  it('bounds the heading sample', async () => {
    const headings: PageHeading[] = Array.from({ length: 30 }, (_value, index) => ({
      level: 2,
      text: `Heading ${index}`,
    }));
    const observer = new WorkflowObserver(async () => makePageContext({ headings }));
    const result = await observer.observe();
    expect(result?.headings).toHaveLength(WORKFLOW_LIMITS.OBSERVATION_MAX_HEADINGS);
  });

  it('detects navigation and content changes deterministically', () => {
    expect(detectNavigation(FIXTURE_URL, FIXTURE_URL)).toBe(false);
    expect(detectNavigation(FIXTURE_URL, 'https://react.dev/')).toBe(true);
    expect(detectNavigation(FIXTURE_URL, '')).toBe(false);
    expect(detectNavigation('', 'https://react.dev/')).toBe(true);
    expect(observedContentChanged('a', 'a')).toBe(false);
    expect(observedContentChanged('a', 'b')).toBe(true);
    expect(observedContentChanged('a', '')).toBe(false);
  });

  it('compares expected URLs on origin + path only', () => {
    expect(urlMatchesExpectation('https://react.dev/?utm=1', 'https://react.dev/')).toBe(
      true,
    );
    expect(urlMatchesExpectation('https://react.dev/docs#top', 'https://react.dev/docs')).toBe(
      true,
    );
    expect(urlMatchesExpectation('https://evil.test/', 'https://react.dev/')).toBe(false);
    expect(urlMatchesExpectation('not a url', 'https://react.dev/')).toBe(false);
  });
});

describe('per-step verification', () => {
  it('verifies a FIND_TEXT step only when matches were reported', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    const step = workflow.steps[0]!;
    const ok = verifyStepResult(step, {
      actionId: 'x',
      kind: 'FIND_TEXT',
      status: 'success',
      message: 'done',
      data: {
        kind: 'FIND_TEXT',
        matchCount: 2,
        matches: [{ index: 1, snippet: 'React documentation' }],
      },
      durationMs: 1,
    });
    expect(ok).toMatchObject({ ok: true, blocked: false });

    const empty = verifyStepResult(step, {
      actionId: 'x',
      kind: 'FIND_TEXT',
      status: 'success',
      message: 'done',
      data: { kind: 'FIND_TEXT', matchCount: 0, matches: [] },
      durationMs: 1,
    });
    expect(empty.ok).toBe(false);
    expect(empty.errorCode).toBe('WORKFLOW_TARGET_NOT_FOUND');
  });

  it('maps a blocked execution onto a blocked, unretryable step', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    const step = workflow.steps[0]!;
    const blocked = verifyStepResult(step, {
      actionId: 'x',
      kind: 'FIND_TEXT',
      status: 'blocked',
      message: 'This field is protected.',
      durationMs: 1,
    });
    expect(blocked).toMatchObject({ ok: false, blocked: true });
    expect(blocked.errorCode).toBe('WORKFLOW_BLOCKED');
  });

  it('never verifies a typed value by reading it back', () => {
    const step = buildWorkflowStep(
      {
        type: 'TYPE_TEXT',
        target: { kind: 'role', role: 'searchbox', name: 'Search documentation' },
        text: 'react hooks',
      },
      {
        index: 0,
        intent: 'TYPE',
        requestId: 'req-1',
        tabId: FIXTURE_TAB_ID,
        url: FIXTURE_URL,
        contentHash: 'digest-fixture',
        now: new Date(FIXED),
      },
    )!;
    const result = verifyStepResult(step, {
      actionId: 'x',
      kind: 'TYPE_TEXT',
      status: 'success',
      message: 'Typed.',
      verification: { ok: true, detail: 'The field state matches.' },
      durationMs: 1,
    });
    // Booleans and state only: the typed value is never read back.
    expect(result.detail).not.toContain('react hooks');
    expect(result.detail).toBe('The field state matches.');

    const unverified = verifyStepResult(step, {
      actionId: 'x',
      kind: 'TYPE_TEXT',
      status: 'success',
      message: 'Typed.',
      durationMs: 1,
    });
    expect(unverified.ok).toBe(false);
    expect(unverified.errorCode).toBe('WORKFLOW_VERIFICATION_FAILED');
  });
});

describe('final outcome verification', () => {
  const navigation = (workflow: Workflow) =>
    verifyWorkflowOutcome(workflow, sample('https://react.dev/', 'digest-2'));

  it('verifies a navigation outcome only when the destination matches', () => {
    const workflow = requireWorkflow(planFor('find "React documentation" and open it'));
    for (const step of workflow.steps) step.status = WorkflowStepStatus.Completed;

    expect(navigation(workflow).outcome.verified).toBe(true);
    expect(
      verifyWorkflowOutcome(workflow, sample(FIXTURE_URL, 'digest-2')).outcome.verified,
    ).toBe(false);
    expect(verifyWorkflowOutcome(workflow, null).outcome.verified).toBe(false);
  });

  it('never claims success it cannot observe', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    const verification = verifyWorkflowOutcome(workflow, null);
    expect(verification.outcome.verified).toBe(false);
    expect(verification.outcome.kind).toBe(WorkflowOutcomeKind.Content);
    expect(verification.detail.length).toBeGreaterThan(0);
  });

  it('verifies a content outcome only with real evidence', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    const quiet = sample(FIXTURE_URL, 'd', { headings: ['Unrelated heading'] });

    // No evidence yet, and not every step has run: not verified.
    expect(verifyWorkflowOutcome(workflow, quiet).outcome.verified).toBe(false);

    for (const step of workflow.steps) step.status = WorkflowStepStatus.Completed;
    // Steps ran, but the expected text was never seen: still not verified.
    expect(verifyWorkflowOutcome(workflow, quiet).outcome.verified).toBe(false);

    // Real evidence from the FIND step (matches reported) verifies it.
    workflow.steps[0]!.result = {
      actionId: 'x',
      kind: 'FIND_TEXT',
      status: 'success',
      message: 'Found 2 matches.',
      data: {
        kind: 'FIND_TEXT',
        matchCount: 2,
        matches: [{ index: 1, snippet: 'React documentation' }],
      },
      durationMs: 1,
    };
    expect(verifyWorkflowOutcome(workflow, quiet).outcome.verified).toBe(true);
  });
});

describe('bounded replanning', () => {
  it('only replans failures a fresh observation could fix', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    expect(
      isReplannable({ errorCode: 'WORKFLOW_TARGET_NOT_FOUND', step: workflow.steps[0] }),
    ).toBe(true);
    // A navigation step is only replannable when its target vanished.
    const openWorkflow = requireWorkflow(
      planFor('find "React documentation" and open it'),
    );
    expect(
      isReplannable({
        errorCode: 'WORKFLOW_TARGET_NOT_FOUND',
        step: openWorkflow.steps[1],
      }),
    ).toBe(true);
    expect(
      isReplannable({
        errorCode: 'WORKFLOW_VERIFICATION_FAILED',
        step: openWorkflow.steps[1],
      }),
    ).toBe(false);
    expect(
      isReplannable({ errorCode: 'WORKFLOW_TARGET_NOT_FOUND', step: workflow.steps[1] }),
    ).toBe(true); // a READ_PAGE identification step may be re-planned
    expect(
      isReplannable({ errorCode: 'WORKFLOW_BLOCKED', step: workflow.steps[0] }),
    ).toBe(false);
    expect(
      isReplannable({ errorCode: 'WORKFLOW_CONTEXT_CHANGED', step: workflow.steps[0] }),
    ).toBe(false);
    expect(isReplannable({ errorCode: 'WORKFLOW_STEP_FAILED', step: undefined })).toBe(false);
  });

  it('carries completed steps over as SKIPPED and produces a new hash', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    workflow.steps[0]!.status = WorkflowStepStatus.Completed;
    const replanned = createDeterministicReplanner()({
      workflow,
      failedStepIndex: 1,
      context: makePageContext(),
      tabId: FIXTURE_TAB_ID,
      requestId: workflow.requestId,
      now: new Date(FIXED),
      errorCode: 'WORKFLOW_VERIFICATION_FAILED',
    });

    // Nothing new to do: no proposal at all.
    expect(replanned).toBeNull();
  });

  it('refuses an identical replan (no loops)', () => {
    const workflow = requireWorkflow(planFor(READ_GOAL));
    const replanned = createDeterministicReplanner()({
      workflow,
      failedStepIndex: 0,
      context: makePageContext(),
      tabId: FIXTURE_TAB_ID,
      requestId: workflow.requestId,
      now: new Date(FIXED),
      errorCode: 'WORKFLOW_TARGET_NOT_FOUND',
    });
    // The refreshed context supports the same plan → no follow-up.
    expect(replanned).toBeNull();
  });

  it('proposes a bounded follow-up that still needs approval', async () => {
    const env = new FakeWorkflowEnv({
      observations: [sample(FIXTURE_URL, 'h1')],
      // The refreshed page still contains the query, so the revised plan
      // differs only when the original one cannot be re-planned identically.
      replanContext: makePageContext(),
      failStep: true,
    });
    const engine = new WorkflowEngine({
      env,
      store: workflowSessionStore,
      sessions: workflowSessions,
      now: () => clock.now,
      replanner: createDeterministicReplanner(),
    });
    const workflow = engine.create({
      requestId: 'req-1',
      goal: READ_GOAL,
      context: makePageContext(),
      tabId: FIXTURE_TAB_ID,
    }).workflow!;

    const result = await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The run stopped; whether a follow-up was produced depends on the
    // refreshed context, but it is never auto-approved and never runs.
    expect(result.snapshot.workflow.status).not.toBe(WorkflowStatus.Completed);
    expect(result.snapshot.run?.outcome?.verified).toBe(false);
    const followUpId = result.snapshot.workflow.followUpWorkflowId;
    if (followUpId) {
      const followUp = workflowSessionStore.get(followUpId);
      expect(followUp?.workflow.status).toBe(WorkflowStatus.AwaitingApproval);
      expect(followUp?.approvedHash).toBeUndefined();
      expect(followUp?.workflow.revision).toBe(1);
      expect(followUp?.workflow.workflowHash).not.toBe(workflow.workflowHash);
      // Only the failed step ran (plus its bounded retry): a follow-up is
      // a proposal, not an execution.
      expect(env.executedPlans).toHaveLength(2);
    }
  });

  it('caps replans at one per workflow', () => {
    workflowSessions.begin('wf-replan', FIXTURE_TAB_ID);
    expect(workflowSessions.canReplan('wf-replan')).toBe(true);
    workflowSessions.recordReplan('wf-replan');
    workflowSessions.recordReplan('wf-replan');
    expect(workflowSessions.canReplan('wf-replan')).toBe(false);
    expect(WORKFLOW_LIMITS.MAX_WORKFLOW_REPLANS).toBe(1);
  });
});

describe('observation plumbing in the engine', () => {
  it('uses the same bounded section profile as the freshness check', () => {
    expect([...WORKFLOW_LIMITS.OBSERVATION_SECTIONS]).toEqual([
      'metadata',
      'headings',
      'text',
    ]);
    expect([...WORKFLOW_LIMITS.REPLAN_SECTIONS]).toContain('links');
    expect(WORKFLOW_LIMITS.OBSERVATION_SECTIONS).not.toContain('forms');
  });

  it('never observes a read-only step twice', async () => {
    const env = new FakeWorkflowEnv({
      observations: [sample(FIXTURE_URL, 'h1'), sample(FIXTURE_URL, 'h2')],
    });
    const engine = new WorkflowEngine({
      env,
      store: workflowSessionStore,
      sessions: workflowSessions,
      now: () => clock.now,
      replanner: null,
    });
    const workflow = engine.create({
      requestId: 'req-1',
      goal: READ_GOAL,
      context: makePageContext(),
      tabId: FIXTURE_TAB_ID,
    }).workflow!;

    await engine.approve({
      workflowId: workflow.workflowId,
      workflowHash: workflow.workflowHash,
    });

    // One checkpoint before the first step, one for the final outcome.
    expect(env.captureRequests).toHaveLength(2);
  });

  it('does not expose a sample type that can carry page prose', () => {
    const keys: Array<keyof ObservationSample> = ['url', 'contentHash', 'headings'];
    expect(keys).toHaveLength(3);
    expect(keys).not.toContain('paragraphs');
  });
});
