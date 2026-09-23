import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildGitHubUrl, describeNavTarget, parseNavTarget } from '@/github/patterns';
import { ActionKind, ActionRisk } from '../types';
import { parseActionCandidate } from '../validator';
import { finalizePlan } from '../planner';
import { actionRegistry } from '../registry';
import { actionSessionStore } from '../session';
import { permissionLedger } from '../permissions';
import { executePlan, type ExecutorEnvironment } from '../executor';
import { computePlanHash } from '../planHash';

/**
 * Phase 7 — typed GitHub navigation is ONE action with a closed target shape.
 * There is no URL-string action anywhere: a raw URL, another host, a
 * traversal path, or an unknown field rejects the candidate outright.
 */
const VALID_TARGET = {
  kind: 'file',
  owner: 'octocat',
  repository: 'hello-world',
  ref: 'main',
  path: 'src/auth/token.ts',
} as const;

const PLAN_CONTEXT = {
  requestId: 'req-nav',
  tabId: 5,
  url: 'https://github.com/octocat/hello-world/pull/42/files',
  contentHash: 'digest-nav',
};

afterEach(() => {
  actionSessionStore.clear();
  permissionLedger.clear();
});

describe('GitHub navigation targets', () => {
  it('accepts typed targets and builds the canonical URL', () => {
    expect(parseNavTarget(VALID_TARGET)).toEqual(VALID_TARGET);
    expect(parseNavTarget({ kind: 'repository', owner: 'a', repository: 'b' })).not.toBeNull();
    expect(parseNavTarget({ kind: 'pull_request', owner: 'a', repository: 'b', number: 42 })).not.toBeNull();
    expect(parseNavTarget({ kind: 'issue', owner: 'a', repository: 'b', number: 7 })).not.toBeNull();
    expect(buildGitHubUrl(VALID_TARGET)).toBe(
      'https://github.com/octocat/hello-world/blob/main/src/auth/token.ts',
    );
  });

  it('rejects raw URLs, other hosts, and unknown fields', () => {
    const rejections: unknown[] = [
      'https://github.com/octocat/hello-world',
      { kind: 'file', url: 'https://github.com/a/b/blob/main/x.ts' },
      { kind: 'file', owner: 'a', repository: 'b', path: 'x.ts', url: 'https://evil.example' },
      { kind: 'url', value: 'https://github.com/a/b' },
      { kind: 'file', owner: 'a', repository: 'b', path: 'https://evil.example/x.ts' },
      { kind: 'file', owner: 'a', repository: 'b', path: '../../etc/passwd' },
      { kind: 'file', owner: 'a', repository: 'b', path: 'x.ts', javascript: 'alert(1)' },
      { kind: 'pull_request', owner: 'a', repository: 'b', number: -1 },
      { kind: 'pull_request', owner: 'a', repository: 'b', number: 1.5 },
      { kind: 'commit', owner: 'a', repository: 'b', sha: 'not a sha' },
      { kind: 'search', query: '' },
      {},
      null,
    ];
    for (const value of rejections) {
      expect(parseNavTarget(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('never produces a URL from a target that failed validation', () => {
    const target = parseNavTarget({
      kind: 'file',
      owner: 'a',
      repository: 'b',
      path: 'ok.ts',
      extra: 'x',
    });
    expect(target).toBeNull();
  });

  it('is registered as a confirmation-required action with a real preview', () => {
    expect(actionRegistry.isRegistered(ActionKind.NavigateGitHub)).toBe(true);
    expect(actionRegistry.riskOf(ActionKind.NavigateGitHub)).toBe(
      ActionRisk.Confirmation,
    );

    const action = parseActionCandidate({ type: 'NAVIGATE_GITHUB', target: VALID_TARGET });
    expect(action).not.toBeNull();
    if (action) {
      expect(actionRegistry.definition(ActionKind.NavigateGitHub).preview(action)).toContain(
        describeNavTarget(VALID_TARGET),
      );
    }
  });

  it('rejects a navigation candidate with a smuggled URL field', () => {
    expect(
      parseActionCandidate({
        type: 'NAVIGATE_GITHUB',
        target: VALID_TARGET,
        url: 'https://evil.example',
      }),
    ).toBeNull();
  });
});

describe('GitHub navigation plans (Phase 4 engine)', () => {
  function makeEnv(navigated: string[]): ExecutorEnvironment {
    return {
      getActiveTab: async () => ({ id: PLAN_CONTEXT.tabId, url: PLAN_CONTEXT.url }),
      sendStep: async () => ({ ok: true, result: { status: 'success', message: 'x' } }),
      captureContentHash: async () => PLAN_CONTEXT.contentHash,
      readPage: async () => null,
      navigateTo: async (_tabId, target) => {
        const url = buildGitHubUrl(target);
        if (url === null) return null;
        navigated.push(url);
        return { url };
      },
    };
  }

  it('stores a plan awaiting approval — nothing navigates on planning', () => {
    const outcome = finalizePlan(
      [{ type: ActionKind.NavigateGitHub, target: VALID_TARGET }],
      PLAN_CONTEXT,
    );
    expect(outcome.plan).toBeDefined();
    expect(outcome.plan?.requiresConfirmation).toBe(true);
    expect(outcome.plan?.risk).toBe(ActionRisk.Confirmation);
  });

  it('executes exactly the approved destination, once', async () => {
    const outcome = finalizePlan(
      [{ type: ActionKind.NavigateGitHub, target: VALID_TARGET }],
      PLAN_CONTEXT,
    );
    const plan = outcome.plan!;
    actionSessionStore.addPlan(plan);

    const navigated: string[] = [];
    permissionLedger.approve(plan.planId, plan.planHash);
    const result = await executePlan(plan.planId, plan.planHash, makeEnv(navigated));

    expect(result.ok).toBe(true);
    expect(navigated).toEqual([
      'https://github.com/octocat/hello-world/blob/main/src/auth/token.ts',
    ]);

    // Single-use: a second attempt with the same approval cannot run.
    const replay = await executePlan(plan.planId, plan.planHash, makeEnv(navigated));
    expect(replay.ok).toBe(false);
  });

  it('refuses a tampered plan and an unapproved plan', async () => {
    const outcome = finalizePlan(
      [{ type: ActionKind.NavigateGitHub, target: VALID_TARGET }],
      PLAN_CONTEXT,
    );
    const plan = outcome.plan!;
    actionSessionStore.addPlan(plan);

    const navigated: string[] = [];
    const forged = await executePlan(plan.planId, 'forged-hash', makeEnv(navigated));
    expect(forged.ok).toBe(false);
    expect(navigated).toEqual([]);

    const unapproved = await executePlan(plan.planId, plan.planHash, makeEnv(navigated));
    expect(unapproved.ok).toBe(false);
    expect(navigated).toEqual([]);
  });

  it('refuses when the page changed since planning (stale context)', async () => {
    const outcome = finalizePlan(
      [{ type: ActionKind.NavigateGitHub, target: VALID_TARGET }],
      PLAN_CONTEXT,
    );
    const plan = outcome.plan!;
    actionSessionStore.addPlan(plan);
    permissionLedger.approve(plan.planId, plan.planHash);

    const navigated: string[] = [];
    const env: ExecutorEnvironment = {
      ...makeEnv(navigated),
      captureContentHash: async () => 'different-digest',
    };
    const result = await executePlan(plan.planId, plan.planHash, env);
    expect(result.ok).toBe(false);
    expect(navigated).toEqual([]);
  });

  it('binds the hash to the target, so a swapped destination cannot run', () => {
    const a = finalizePlan(
      [{ type: ActionKind.NavigateGitHub, target: VALID_TARGET }],
      PLAN_CONTEXT,
    ).plan!;
    const b = finalizePlan(
      [
        {
          type: ActionKind.NavigateGitHub,
          target: { ...VALID_TARGET, path: 'src/other.ts' },
        },
      ],
      PLAN_CONTEXT,
    ).plan!;

    const tampered = { ...a, actions: b.actions };
    expect(computePlanHash(tampered)).not.toBe(a.planHash);
  });
});

describe('GitHub navigation execution failures are bounded and honest', () => {
  beforeEach(() => {
    actionSessionStore.clear();
    permissionLedger.clear();
  });

  it('reports a failure when the tab cannot be moved, and stops', async () => {
    const outcome = finalizePlan(
      [{ type: ActionKind.NavigateGitHub, target: VALID_TARGET }],
      PLAN_CONTEXT,
    );
    const plan = outcome.plan!;
    actionSessionStore.addPlan(plan);
    permissionLedger.approve(plan.planId, plan.planHash);

    const result = await executePlan(plan.planId, plan.planHash, {
      getActiveTab: async () => ({ id: PLAN_CONTEXT.tabId, url: PLAN_CONTEXT.url }),
      sendStep: async () => ({ ok: true, result: { status: 'success', message: 'x' } }),
      captureContentHash: async () => PLAN_CONTEXT.contentHash,
      readPage: async () => null,
      navigateTo: async () => null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.status).toBe('failed');
      expect(result.result.steps[0]?.status).toBe('failed');
    }
  });
});
