import { describe, expect, it } from 'vitest';
import {
  buildExecuteActionRequest,
  EXECUTE_ACTION_REQUEST_TYPE,
  isContentActionResponse,
  isExecuteActionRequest,
} from '../protocol';

describe('action wire protocol (Phase 4)', () => {
  const valid = buildExecuteActionRequest('plan-1', {
    stepId: 'step-1',
    action: { type: 'CLICK_ELEMENT', target: { kind: 'text', text: 'Go' } },
    preview: 'Click “Go”',
  });

  it('builds versioned, typed requests', () => {
    expect(valid).toMatchObject({
      v: 1,
      type: EXECUTE_ACTION_REQUEST_TYPE,
      stepId: 'step-1',
      planId: 'plan-1',
    });
  });

  it('accepts well-formed requests', () => {
    expect(isExecuteActionRequest(valid)).toBe(true);
    expect(
      isExecuteActionRequest({
        ...valid,
        action: { type: 'SCROLL', direction: 'down' },
      }),
    ).toBe(true);
  });

  it('rejects wrong protocol version or type', () => {
    expect(isExecuteActionRequest({ ...valid, v: 2 })).toBe(false);
    expect(isExecuteActionRequest({ ...valid, type: 'cl:other' })).toBe(false);
  });

  it('rejects requests with executable-content keys', () => {
    for (const key of ['javascript', 'script', 'code', 'eval', 'selector', 'xpath', 'command', 'html']) {
      const hostile = { ...valid, action: { ...valid.action, [key]: 'x' } };
      expect(isExecuteActionRequest(hostile), key).toBe(false);
    }
  });

  it('rejects selector-shaped or unknown target keys', () => {
    expect(
      isExecuteActionRequest({
        ...valid,
        action: {
          type: 'CLICK_ELEMENT',
          target: { kind: 'selector', selector: '.evil' },
        },
      }),
    ).toBe(false);
    expect(
      isExecuteActionRequest({
        ...valid,
        action: {
          type: 'CLICK_ELEMENT',
          target: { kind: 'text', text: 'Go', onclick: 'evil()' },
        },
      }),
    ).toBe(false);
  });

  it('rejects unknown action kinds and garbage', () => {
    expect(
      isExecuteActionRequest({ ...valid, action: { type: 'EXECUTE_JAVASCRIPT' } }),
    ).toBe(false);
    expect(isExecuteActionRequest(null)).toBe(false);
    expect(isExecuteActionRequest('')).toBe(false);
    expect(isExecuteActionRequest({ ...valid, stepId: '' })).toBe(false);
  });

  it('parses content responses structurally', () => {
    expect(
      isContentActionResponse({
        ok: true,
        result: { status: 'success', message: 'done' },
      }),
    ).toBe(true);
    expect(
      isContentActionResponse({ ok: false, error: 'ACTION_TARGET_NOT_FOUND' }),
    ).toBe(true);
    expect(isContentActionResponse({ ok: true })).toBe(false);
    expect(
      isContentActionResponse({ ok: true, result: { status: 'success' } }),
    ).toBe(false);
    expect(isContentActionResponse(null)).toBe(false);
  });
});
