import { describe, expect, it } from 'vitest';
import { computePlanHash, hashActions } from '../planHash';
import type { ActionPlan } from '../types';

type Binding = Pick<ActionPlan, 'actions' | 'tabId' | 'url' | 'contentHash'>;

const plan: Binding = {
  actions: [
    {
      stepId: 'step-1',
      action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
      preview: 'Click “Go”',
    },
  ],
  tabId: 3,
  url: 'https://example.com/',
  contentHash: 'ctx-1',
};

describe('plan hash binding (Phase 4)', () => {
  it('is deterministic for identical plans (ignores volatile fields)', () => {
    const a = computePlanHash(plan);
    const b = computePlanHash({
      ...plan,
      actions: [
        {
          stepId: 'DIFFERENT-STEP-ID',
          action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
          preview: 'Different preview wording',
        },
      ],
    });
    expect(a).toBe(b);
  });

  it('changes when any binding field changes', () => {
    const base = computePlanHash(plan);
    expect(
      computePlanHash({
        ...plan,
        actions: [
          {
            stepId: 's',
            action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Stop' } },
            preview: '',
          },
        ],
      }),
    ).not.toBe(base);
    expect(computePlanHash({ ...plan, tabId: 4 })).not.toBe(base);
    expect(computePlanHash({ ...plan, url: 'https://other.com/' })).not.toBe(base);
    expect(computePlanHash({ ...plan, contentHash: 'ctx-2' })).not.toBe(base);
  });

  it('is insensitive to key order in payloads', () => {
    const a = hashActions([{ action: { type: 'SCROLL', direction: 'down' } }]);
    const b = hashActions([{ action: { direction: 'down', type: 'SCROLL' } }]);
    expect(a).toBe(b);
  });

  it('distinguishes action order', () => {
    const ab = computePlanHash({
      ...plan,
      actions: [
        { stepId: '1', action: { type: 'SCROLL', direction: 'down' }, preview: '' },
        { stepId: '2', action: { type: 'READ_PAGE' }, preview: '' },
      ],
    });
    const ba = computePlanHash({
      ...plan,
      actions: [
        { stepId: '2', action: { type: 'READ_PAGE' }, preview: '' },
        { stepId: '1', action: { type: 'SCROLL', direction: 'down' }, preview: '' },
      ],
    });
    expect(ab).not.toBe(ba);
  });
});
