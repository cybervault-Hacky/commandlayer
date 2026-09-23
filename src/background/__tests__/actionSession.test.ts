import { afterEach, describe, expect, it } from 'vitest';
import {
  cancelPlan,
  executeApprovedPlan,
} from '../actionSession';
import { planAction } from '@/actions/planner';
import { actionSessionStore } from '@/actions/session';
import { permissionLedger } from '@/actions/permissions';
import { ActionErrorCode } from '@/actions/types';
import type { ExecutorEnvironment } from '@/actions/executor';

const TAB = { id: 12, url: 'https://news.example.com/story' };

const env: ExecutorEnvironment = {
  getActiveTab: async () => TAB,
  sendStep: async () => ({ ok: true, result: { status: 'success', message: 'ok' } }),
  captureContentHash: async () => '',
  readPage: async () => null,
  navigateTo: async () => null,
};

function seedPlan(text: string) {
  const outcome = planAction(text, {
    requestId: 'req-9',
    tabId: TAB.id,
    url: TAB.url,
    contentHash: 'ctx-9',
  });
  const plan = outcome.plan!;
  actionSessionStore.addPlan(plan);
  return plan;
}

afterEach(() => {
  actionSessionStore.clear();
  permissionLedger.clear();
});

describe('background action session (Phase 4)', () => {
  it('executes an approved plan end to end via executeApprovedPlan', async () => {
    const plan = seedPlan('scroll down');
    const result = await executeApprovedPlan({
      planId: plan.planId,
      planHash: plan.planHash,
      source: 'sidepanel',
      env,
    });
    expect(result.status).toBe('completed');
    expect(result.execution?.status).toBe('completed');
    expect(result.execution?.steps[0]?.kind).toBe('SCROLL');
    expect(result.id).toBe('req-9'); // tied to the originating command
  });

  it('rejects a tampered planHash (approved plan must equal executed plan)', async () => {
    const plan = seedPlan('scroll down');
    const result = await executeApprovedPlan({
      planId: plan.planId,
      planHash: 'forged-hash',
      source: 'sidepanel',
      env,
    });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe(ActionErrorCode.ACTION_PLAN_CHANGED);
    expect(result.execution).toBeUndefined();
  });

  it('rejects unknown plan ids', async () => {
    const result = await executeApprovedPlan({
      planId: 'plan-does-not-exist',
      planHash: 'whatever',
      source: 'sidepanel',
      env,
    });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe(ActionErrorCode.ACTION_PLAN_UNKNOWN);
  });

  it('detects stale context (different tab) at execution time', async () => {
    const plan = seedPlan('scroll down');
    const movedEnv: ExecutorEnvironment = {
      ...env,
      getActiveTab: async () => ({ id: 99, url: TAB.url }),
    };
    const result = await executeApprovedPlan({
      planId: plan.planId,
      planHash: plan.planHash,
      source: 'sidepanel',
      env: movedEnv,
    });
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe(ActionErrorCode.ACTION_CONTEXT_STALE);
  });

  it('cancelPlan withdraws approval and removes the plan', async () => {
    const plan = seedPlan('scroll down');
    permissionLedger.approve(plan.planId, plan.planHash);
    cancelPlan(plan.planId);
    expect(actionSessionStore.get(plan.planId)).toBeUndefined();
    expect(permissionLedger.has(plan.planId)).toBe(false);

    // Nothing left to execute.
    const result = await executeApprovedPlan({
      planId: plan.planId,
      planHash: plan.planHash,
      source: 'sidepanel',
      env,
    });
    expect(result.errorCode).toBe(ActionErrorCode.ACTION_PLAN_UNKNOWN);
  });

  it('never leaks sensitive content in results (statuses + booleans only)', async () => {
    const plan = seedPlan('scroll down');
    const result = await executeApprovedPlan({
      planId: plan.planId,
      planHash: plan.planHash,
      source: 'sidepanel',
      env,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('api_key');
  });
});
