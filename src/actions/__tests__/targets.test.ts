import { describe, expect, it } from 'vitest';
import { ACTION_LIMITS } from '../limits';
import { describeTarget, parseElementTarget } from '../targets';

describe('element target model (Phase 4)', () => {
  it('parses the three safe target kinds', () => {
    expect(parseElementTarget({ kind: 'text', text: 'Sign in' })).toEqual({
      kind: 'text',
      text: 'Sign in',
    });
    expect(
      parseElementTarget({ kind: 'role', role: 'button', name: 'Save' }),
    ).toEqual({ kind: 'role', role: 'button', name: 'Save' });
    expect(parseElementTarget({ kind: 'stable-id', id: 'loginButton' })).toEqual({
      kind: 'stable-id',
      id: 'loginButton',
    });
  });

  it('supports bounded occurrence indexes', () => {
    expect(
      parseElementTarget({ kind: 'text', text: 'More', occurrence: 2 }),
    ).toEqual({ kind: 'text', text: 'More', occurrence: 2 });
    expect(
      parseElementTarget({ kind: 'text', text: 'More', occurrence: 0 }),
    ).toBeNull();
    expect(
      parseElementTarget({ kind: 'text', text: 'More', occurrence: 51 }),
    ).toBeNull();
    expect(
      parseElementTarget({ kind: 'text', text: 'More', occurrence: 1.5 }),
    ).toBeNull();
  });

  it('rejects selector-shaped kinds entirely', () => {
    for (const target of [
      { kind: 'selector', selector: '.btn' },
      { kind: 'css', selector: '#x' },
      { kind: 'xpath', xpath: '//a' },
      { kind: 'coordinate', x: 10, y: 20 },
      { kind: 'ai', anything: true },
      {},
      null,
      'Sign in',
    ]) {
      expect(parseElementTarget(target)).toBeNull();
    }
  });

  it('rejects roles outside the closed allowlist', () => {
    expect(
      parseElementTarget({ kind: 'role', role: 'wizard', name: 'Go' }),
    ).toBeNull();
    expect(
      parseElementTarget({ kind: 'role', role: 'button', name: '' }),
    ).toBeNull();
  });

  it('rejects oversized target text', () => {
    const long = 'x'.repeat(ACTION_LIMITS.MAX_TARGET_TEXT + 1);
    expect(parseElementTarget({ kind: 'text', text: long })).toBeNull();
    expect(
      parseElementTarget({ kind: 'role', role: 'button', name: long }),
    ).toBeNull();
  });

  it('rejects selector-shaped stable ids', () => {
    for (const id of [
      '.btn',
      '#login',
      'a > b',
      'button[data-x]',
      '//div',
      '1leading-digit',
      '',
      'x'.repeat(200),
    ]) {
      expect(parseElementTarget({ kind: 'stable-id', id })).toBeNull();
    }
  });

  it('rejects unknown extra fields on targets', () => {
    expect(
      parseElementTarget({ kind: 'text', text: 'Go', javascript: 'x' }),
    ).toBeNull();
    expect(
      parseElementTarget({ kind: 'stable-id', id: 'go', eval: '1' }),
    ).toBeNull();
  });

  it('describes targets without selectors', () => {
    expect(describeTarget({ kind: 'text', text: 'Sign in' })).toContain('Sign in');
    expect(
      describeTarget({ kind: 'role', role: 'button', name: 'Save' }),
    ).toContain('button');
    expect(describeTarget({ kind: 'stable-id', id: 'go' })).toContain('#go');
  });
});
