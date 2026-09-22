import { afterEach, describe, expect, it } from 'vitest';
import { ACTION_LIMITS } from '../limits';
import { ActionEvent } from '../machine';
import { actionSessionStore } from '../session';
import { ActionSessionState, type ActionPlan } from '../types';

function makePlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  const createdAt = Date.now();
  return {
    planId: `plan-${Math.random().toString(36).slice(2)}`,
    requestId: 'req-1',
    tabId: 1,
    url: 'https://example.com/',
    contentHash: 'ctx',
    actions: [
      { stepId: 's1', action: { type: 'READ_PAGE' }, preview: 'Read page' },
    ],
    risk: 'READ_ONLY',
    requiresConfirmation: false,
    planHash: 'hash-1',
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + ACTION_LIMITS.PLAN_TTL_MS).toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  actionSessionStore.setClock(Date.now);
  actionSessionStore.clear();
});

describe('plan session store (Phase 4)', () => {
  it('stores new plans in AWAITING_PERMISSION (preview implies request)', () => {
    const plan = makePlan();
    actionSessionStore.addPlan(plan);
    expect(actionSessionStore.state(plan.planId)).toBe(
      ActionSessionState.AwaitingPermission,
    );
    expect(actionSessionStore.get(plan.planId)?.plan).toBe(plan);
  });

  it('expires plans after TTL', () => {
    let clock = 2_000_000;
    actionSessionStore.setClock(() => clock);

    const createdAt = clock - 1000;
    const plan = makePlan({
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + ACTION_LIMITS.PLAN_TTL_MS).toISOString(),
    });
    actionSessionStore.addPlan(plan);
    expect(actionSessionStore.get(plan.planId)).toBeDefined();

    clock = createdAt + ACTION_LIMITS.PLAN_TTL_MS + 1;
    expect(actionSessionStore.get(plan.planId)).toBeUndefined();
  });

  it('stays bounded at MAX_PENDING_PLANS', () => {
    for (let i = 0; i < ACTION_LIMITS.MAX_PENDING_PLANS + 5; i++) {
      actionSessionStore.addPlan(makePlan());
    }
    expect(actionSessionStore.size()).toBeLessThanOrEqual(
      ACTION_LIMITS.MAX_PENDING_PLANS,
    );
  });

  it('applies state-machine events and rejects invalid transitions', () => {
    const plan = makePlan();
    actionSessionStore.addPlan(plan);
    // AwaitingPermission → Approve is valid…
    expect(actionSessionStore.apply(plan.planId, ActionEvent.Approve)).toBe(true);
    // …but Complete is not valid from APPROVED.
    expect(actionSessionStore.apply(plan.planId, ActionEvent.Complete)).toBe(false);
    // Unknown plans are never transitioned.
    expect(actionSessionStore.apply('nope', ActionEvent.Cancel)).toBe(false);
  });

  it('disposes plans on demand', () => {
    const plan = makePlan();
    actionSessionStore.addPlan(plan);
    actionSessionStore.dispose(plan.planId);
    expect(actionSessionStore.get(plan.planId)).toBeUndefined();
  });
});
