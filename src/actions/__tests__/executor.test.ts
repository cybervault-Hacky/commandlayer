import { afterEach, describe, expect, it, vi } from 'vitest';
import { executePlan, type ExecutorEnvironment } from '../executor';
import { computePlanHash } from '../planHash';
import { permissionLedger } from '../permissions';
import { actionSessionStore } from '../session';
import { ActionErrorCode, type ActionPlan } from '../types';
import { ACTION_LIMITS } from '../limits';

const TAB = { id: 7, url: 'https://example.com/docs' };

/** Builds a plan whose planHash is the REAL deterministic hash. */
function makePlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  const now = Date.now();
  const base: ActionPlan = {
    planId: 'plan-1',
    requestId: 'req-1',
    tabId: TAB.id,
    url: TAB.url,
    contentHash: 'ctx-1',
    actions: [
      {
        stepId: 's1',
        action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
        preview: 'Click “Go”',
      },
    ],
    risk: 'CONFIRMATION_REQUIRED',
    requiresConfirmation: true,
    planHash: '',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ACTION_LIMITS.PLAN_TTL_MS).toISOString(),
    ...overrides,
  };
  // Hash over the binding fields; callers overriding planHash keep theirs.
  if (!overrides.planHash) {
    base.planHash = computePlanHash(base);
  }
  return base;
}

function makeEnv(overrides: Partial<ExecutorEnvironment> = {}): ExecutorEnvironment {
  return {
    getActiveTab: async () => TAB,
    sendStep: async () => ({
      ok: true,
      result: { status: 'success', message: 'done' },
    }),
    captureContentHash: async () => 'ctx-1',
    readPage: async () => ({
      kind: 'READ_PAGE',
      title: 'Page',
      url: TAB.url,
      stats: '1 headings',
      topHeadings: [],
    }),
    navigateTo: async (tabId, target) => {
      void tabId;
      void target;
      return null;
    },
    ...overrides,
  };
}

/** Seed a stored plan in AWAITING_PERMISSION, as the planner would. */
function seed(plan: ActionPlan): void {
  actionSessionStore.addPlan(plan);
}

afterEach(() => {
  actionSessionStore.clear();
  permissionLedger.clear();
  permissionLedger.setClock(Date.now);
});

describe('executor — the only path to execution (Phase 4)', () => {
  it('executes an approved, hash-bound, fresh plan', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);

    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.status).toBe('completed');
      expect(outcome.result.steps).toHaveLength(1);
      expect(outcome.result.steps[0]!.status).toBe('success');
    }
    // Single-use: the plan is disposed after its one authorized run.
    expect(actionSessionStore.get(plan.planId)).toBeUndefined();
  });

  it('refuses unknown plans (nothing executes from caller input alone)', async () => {
    const plan = makePlan(); // never added to the store
    permissionLedger.approve(plan.planId, plan.planHash);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_PLAN_UNKNOWN);
    }
  });

  it('refuses when the claimed hash differs from the stored plan', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, 'evil-hash');
    const outcome = await executePlan(plan.planId, 'evil-hash', makeEnv());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_PLAN_CHANGED);
    }
  });

  it('detects tampering of a stored plan (hash no longer matches content)', async () => {
    const plan = makePlan();
    seed(plan);
    // Simulate tampering: change an action after the hash was computed.
    const record = actionSessionStore.get(plan.planId)!;
    record.plan.actions[0]!.action = {
      type: 'CLICK_ELEMENT',
      target: { kind: 'text', text: 'Do something else' },
    };
    permissionLedger.approve(plan.planId, plan.planHash);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_PLAN_CHANGED);
    }
  });

  it('refuses to execute without an approval (unapproved never runs)', async () => {
    const plan = makePlan();
    seed(plan);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_REQUIRED);
    }
  });

  it('refuses a second execution with a consumed approval', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const first = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(first.ok).toBe(true);

    // Re-seed the same plan and try to reuse the consumed approval.
    seed(plan);
    const second = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_DENIED);
    }
  });

  it('refuses execution of an expired approval', async () => {
    let clock = 5_000_000;
    permissionLedger.setClock(() => clock);

    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    clock += ACTION_LIMITS.PLAN_TTL_MS + 1;

    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_EXPIRED);
    }
  });

  it('detects tab or URL changes (context stale)', async () => {
    for (const env of [
      makeEnv({ getActiveTab: async () => ({ id: 8, url: TAB.url }) }),
      makeEnv({ getActiveTab: async () => ({ id: TAB.id, url: 'https://other.com/' }) }),
      makeEnv({ getActiveTab: async () => null }),
    ]) {
      const plan = makePlan({ planId: `plan-${Math.random()}` });
      seed(plan);
      permissionLedger.approve(plan.planId, plan.planHash);
      const outcome = await executePlan(plan.planId, plan.planHash, env);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe(ActionErrorCode.ACTION_CONTEXT_STALE);
      }
      expect(actionSessionStore.get(plan.planId)).toBeUndefined(); // disposed on stale
    }
  });

  it('detects content changes before target actions run', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv({
      captureContentHash: async () => 'ctx-CHANGED',
    }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_CONTEXT_STALE);
    }
  });

  it('skips content-hash freshness for target-free plans (READ_PAGE)', async () => {
    const plan = makePlan({
      actions: [{ stepId: 'r1', action: { type: 'READ_PAGE' }, preview: 'Read page' }],
      risk: 'READ_ONLY',
      requiresConfirmation: false,
    });
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const capture = vi.fn(async () => 'ctx-CHANGED');
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv({
      captureContentHash: capture,
    }));
    expect(outcome.ok).toBe(true);
    expect(capture).not.toHaveBeenCalled();
  });

  it('runs READ_PAGE through the environment, not the content channel', async () => {
    const sendStep = vi.fn();
    const plan = makePlan({
      actions: [{ stepId: 'r1', action: { type: 'READ_PAGE' }, preview: 'Read page' }],
      risk: 'READ_ONLY',
      requiresConfirmation: false,
    });
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv({ sendStep }));
    expect(outcome.ok).toBe(true);
    expect(sendStep).not.toHaveBeenCalled();
    if (outcome.ok) {
      expect(outcome.result.steps[0]!.data?.kind).toBe('READ_PAGE');
    }
  });

  it('stops on the FIRST non-success step (no blind continue)', async () => {
    const plan = makePlan({
      actions: [
        { stepId: 's1', action: { type: 'SCROLL', direction: 'down' }, preview: 'Scroll' },
        { stepId: 's2', action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'X' } }, preview: 'Click X' },
        { stepId: 's3', action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Y' } }, preview: 'Click Y' },
      ],
    });
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);

    const sendStep = vi.fn(async (_tab: number, message: unknown) => {
      const stepId = (message as { stepId: string }).stepId;
      if (stepId === 's2') {
        return { ok: false, error: ActionErrorCode.ACTION_EXECUTION_FAILED };
      }
      return { ok: true, result: { status: 'success', message: 'ok' } };
    });

    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv({ sendStep }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.status).toBe('failed');
      expect(outcome.result.stoppedAt).toBe(1);
      expect(outcome.result.steps).toHaveLength(2); // s3 never ran
      expect(outcome.result.steps[1]!.status).toBe('failed');
      expect(outcome.result.summary).toContain('Click X');
    }
  });

  it('marks the run blocked when a step is blocked (sensitive guard)', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv({
      sendStep: async () => ({ ok: false, error: ActionErrorCode.ACTION_SENSITIVE_FIELD }),
    }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.status).toBe('blocked');
      expect(outcome.result.steps[0]!.status).toBe('blocked');
    }
  });

  it('fails cleanly on non-responsive or malformed content replies', async () => {
    const a = makePlan({ planId: 'p-noresp' });
    seed(a);
    permissionLedger.approve(a.planId, a.planHash);
    const noResp = await executePlan(a.planId, a.planHash, makeEnv({
      sendStep: async () => {
        throw new Error('no receiver');
      },
    }));
    expect(noResp.ok).toBe(true);
    if (noResp.ok) expect(noResp.result.status).toBe('failed');

    const b = makePlan({ planId: 'p-garbage' });
    seed(b);
    permissionLedger.approve(b.planId, b.planHash);
    const garbage = await executePlan(b.planId, b.planHash, makeEnv({
      sendStep: async () => ({ totally: 'unexpected' }),
    }));
    expect(garbage.ok).toBe(true);
    if (garbage.ok) expect(garbage.result.status).toBe('failed');
  });

  it('refuses unregistered action kinds even if smuggled into the store', async () => {
    const plan = makePlan({
      actions: [
        {
          stepId: 'evil',
          // Cast: this shape can never enter through the validator — the
          // registry gate must still refuse it at execution time.
          action: { type: 'EXECUTE_JAVASCRIPT' } as unknown as never,
          preview: 'evil',
        },
      ],
    });
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.status).toBe('blocked');
      expect(outcome.result.steps[0]!.status).toBe('blocked');
    }
  });

  it('cannot execute twice: the plan is gone after the first run', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    const first = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(first.ok).toBe(true);
    const second = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe(ActionErrorCode.ACTION_PLAN_UNKNOWN);
    }
  });

  it('leaves the store in a terminal or disposed state after stale checks', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    await executePlan(plan.planId, plan.planHash, makeEnv({
      captureContentHash: async () => 'changed',
    }));
    expect(actionSessionStore.state(plan.planId)).toBeUndefined();
  });

  it('rejects execution when the plan is not awaiting permission', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    // Force an invalid state: cancel first.
    actionSessionStore.apply(plan.planId, 'CANCEL');
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(ActionErrorCode.ACTION_PERMISSION_REQUIRED);
    }
  });

  it('never executes a plan whose stored state is already terminal', async () => {
    const plan = makePlan();
    seed(plan);
    permissionLedger.approve(plan.planId, plan.planHash);
    actionSessionStore.apply(plan.planId, 'CANCEL');
    actionSessionStore.dispose(plan.planId);
    const outcome = await executePlan(plan.planId, plan.planHash, makeEnv());
    expect(outcome.ok).toBe(false);
  });
});
