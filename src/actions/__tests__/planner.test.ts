import { describe, expect, it } from 'vitest';
import { ActionRisk } from '../types';
import { ACTION_LIMITS } from '../limits';
import { computePlanHash } from '../planHash';
import {
  looksLikeActionRequest,
  planAction,
  type PlanContext,
} from '../planner';

const context: PlanContext = {
  requestId: 'req-1',
  tabId: 7,
  url: 'https://example.com/docs',
  contentHash: 'hash-abc',
};

describe('deterministic action planner (Phase 4)', () => {
  it('plans a SCROLL from natural phrasing', () => {
    const outcome = planAction('scroll down', context);
    expect(outcome.plan).toBeDefined();
    expect(outcome.plan!.actions[0]!.action).toEqual({
      type: 'SCROLL',
      direction: 'down',
      distancePx: 600,
    });
    expect(outcome.plan!.risk).toBe(ActionRisk.Low);
    expect(outcome.plan!.requiresConfirmation).toBe(false);
  });

  it('plans bounded scroll distances and directions', () => {
    expect(planAction('scroll up 800px', context).plan!.actions[0]!.action)
      .toMatchObject({ type: 'SCROLL', direction: 'up', distancePx: 800 });
    expect(planAction('scroll to the top', context).plan!.actions[0]!.action)
      .toEqual({ type: 'SCROLL', direction: 'top' });
    expect(planAction('scroll to bottom', context).plan!.actions[0]!.action)
      .toEqual({ type: 'SCROLL', direction: 'bottom' });
    // Distances are clamped to the hard limit at parse time.
    expect(
      planAction('scroll down 99999px', context).plan!.actions[0]!.action,
    ).toMatchObject({ distancePx: ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX });
  });

  it('plans FIND_TEXT only with a quoted query', () => {
    const outcome = planAction('find "pricing plans" on the page', context);
    expect(outcome.plan!.actions[0]!.action).toEqual({
      type: 'FIND_TEXT',
      query: 'pricing plans',
    });
    expect(outcome.plan!.risk).toBe(ActionRisk.ReadOnly);
    // No quoted query → nothing to plan.
    expect(planAction('find something vague', context).plan).toBeUndefined();
  });

  it('plans CLICK_ELEMENT by quoted target with role hints', () => {
    const byRole = planAction('click the "Sign in" button', context);
    expect(byRole.plan!.actions[0]!.action).toEqual({
      type: 'CLICK_ELEMENT',
      target: { kind: 'role', role: 'button', name: 'Sign in' },
    });
    expect(byRole.plan!.risk).toBe(ActionRisk.Confirmation);
    expect(byRole.plan!.requiresConfirmation).toBe(true);

    const byText = planAction('press "Next"', context);
    expect(byText.plan!.actions[0]!.action).toEqual({
      type: 'CLICK_ELEMENT',
      target: { kind: 'text', text: 'Next' },
    });
  });

  it('plans TYPE_TEXT and SELECT_OPTION with confirmation risk', () => {
    const typed = planAction('type "Mumbai" into the "City" field', context);
    expect(typed.plan!.actions[0]!.action).toMatchObject({
      type: 'TYPE_TEXT',
      text: 'Mumbai',
      target: { kind: 'text', text: 'City' },
    });
    expect(typed.plan!.requiresConfirmation).toBe(true);

    const selected = planAction('select "India" in the "Country" dropdown', context);
    expect(selected.plan!.actions[0]!.action).toMatchObject({
      type: 'SELECT_OPTION',
      option: 'India',
      target: { kind: 'text', text: 'Country' },
    });
  });

  it('plans READ_PAGE', () => {
    const outcome = planAction('read this page', context);
    expect(outcome.plan!.actions[0]!.action).toEqual({ type: 'READ_PAGE' });
    expect(outcome.plan!.risk).toBe(ActionRisk.ReadOnly);
  });

  it('returns no plan for non-action text (reasoning keeps those)', () => {
    for (const text of [
      'Summarize this article',
      'What is this page about?',
      'Explain the pricing model',
      'hello there',
    ]) {
      expect(planAction(text, context).plan).toBeUndefined();
    }
  });

  it('binds the plan to tab, URL, and content hash', () => {
    const plan = planAction('scroll down', context).plan!;
    expect(plan.tabId).toBe(7);
    expect(plan.url).toBe('https://example.com/docs');
    expect(plan.contentHash).toBe('hash-abc');
    expect(plan.planHash).toBe(computePlanHash(plan));
    expect(plan.expiresAt > plan.createdAt).toBe(true);
  });

  it('hashes differ across different actions or contexts', () => {
    const a = planAction('scroll down', context).plan!;
    const b = planAction('scroll up', context).plan!;
    const c = planAction('scroll down', { ...context, tabId: 8 }).plan!;
    const d = planAction('scroll down', { ...context, contentHash: 'hash-def' }).plan!;
    const hashes = new Set([a.planHash, b.planHash, c.planHash, d.planHash]);
    expect(hashes.size).toBe(4);
  });

  it('never plans more than the action cap', () => {
    for (const text of ['click "a"', 'find "x"', 'scroll down']) {
      const plan = planAction(text, context).plan;
      if (plan) {
        expect(plan.actions.length).toBeLessThanOrEqual(
          ACTION_LIMITS.MAX_ACTIONS_PER_PLAN,
        );
      }
    }
  });

  it('looksLikeActionRequest pre-filter matches the planner vocabulary', () => {
    expect(looksLikeActionRequest('click the "Save" button')).toBe(true);
    expect(looksLikeActionRequest('scroll to top')).toBe(true);
    expect(looksLikeActionRequest('find "alpha"')).toBe(true);
    expect(looksLikeActionRequest('read the page')).toBe(true);
    expect(looksLikeActionRequest('Summarize this page')).toBe(false);
    expect(looksLikeActionRequest('What does this mean?')).toBe(false);
  });
});
