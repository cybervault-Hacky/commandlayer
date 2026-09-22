import { describe, expect, it } from 'vitest';
import { ACTION_LIMITS } from '../limits';
import {
  parseActionCandidate,
  parseActionListCandidate,
} from '../validator';

describe('action validator — typed allowlist (Phase 4)', () => {
  describe('valid candidates', () => {
    it('accepts READ_PAGE with no payload', () => {
      expect(parseActionCandidate({ type: 'READ_PAGE' })).toEqual({
        type: 'READ_PAGE',
      });
    });

    it('accepts SCROLL with direction and bounded distance', () => {
      expect(
        parseActionCandidate({ type: 'SCROLL', direction: 'down', distancePx: 400 }),
      ).toEqual({ type: 'SCROLL', direction: 'down', distancePx: 400 });
      expect(parseActionCandidate({ type: 'SCROLL', direction: 'top' })).toEqual({
        type: 'SCROLL',
        direction: 'top',
      });
    });

    it('accepts FIND_TEXT with a bounded query', () => {
      expect(parseActionCandidate({ type: 'FIND_TEXT', query: 'pricing' })).toEqual({
        type: 'FIND_TEXT',
        query: 'pricing',
      });
      expect(
        parseActionCandidate({
          type: 'FIND_TEXT',
          query: 'pricing',
          caseSensitive: true,
        }),
      ).toEqual({ type: 'FIND_TEXT', query: 'pricing', caseSensitive: true });
    });

    it('accepts CLICK_ELEMENT with every safe target kind', () => {
      expect(
        parseActionCandidate({
          type: 'CLICK_ELEMENT',
          target: { kind: 'text', text: 'Sign in' },
        }),
      ).toEqual({
        type: 'CLICK_ELEMENT',
        target: { kind: 'text', text: 'Sign in' },
      });
      expect(
        parseActionCandidate({
          type: 'CLICK_ELEMENT',
          target: { kind: 'role', role: 'button', name: 'Save' },
        }),
      ).toEqual({
        type: 'CLICK_ELEMENT',
        target: { kind: 'role', role: 'button', name: 'Save' },
      });
      expect(
        parseActionCandidate({
          type: 'CLICK_ELEMENT',
          target: { kind: 'stable-id', id: 'submitBtn' },
        }),
      ).toEqual({
        type: 'CLICK_ELEMENT',
        target: { kind: 'stable-id', id: 'submitBtn' },
      });
    });

    it('accepts TYPE_TEXT and SELECT_OPTION', () => {
      expect(
        parseActionCandidate({
          type: 'TYPE_TEXT',
          target: { kind: 'role', role: 'textbox', name: 'City' },
          text: 'Pune',
        }),
      ).toMatchObject({ type: 'TYPE_TEXT', text: 'Pune' });
      expect(
        parseActionCandidate({
          type: 'SELECT_OPTION',
          target: { kind: 'text', text: 'Country' },
          option: 'India',
        }),
      ).toMatchObject({ type: 'SELECT_OPTION', option: 'India' });
    });
  });

  describe('unknown and malformed candidates', () => {
    it('rejects unknown action types', () => {
      expect(parseActionCandidate({ type: 'EXECUTE_JAVASCRIPT' })).toBeNull();
      expect(parseActionCandidate({ type: 'SHELL_COMMAND' })).toBeNull();
      expect(parseActionCandidate({ type: 'NAVIGATE' })).toBeNull();
      expect(parseActionCandidate({ type: 'DOWNLOAD_FILE' })).toBeNull();
      expect(parseActionCandidate({ type: '' })).toBeNull();
      expect(parseActionCandidate({ type: 42 })).toBeNull();
    });

    it('rejects non-object candidates', () => {
      expect(parseActionCandidate(null)).toBeNull();
      expect(parseActionCandidate(undefined)).toBeNull();
      expect(parseActionCandidate('SCROLL')).toBeNull();
      expect(parseActionCandidate(['SCROLL'])).toBeNull();
    });

    it('rejects executable-content fields on any action', () => {
      const hostile = [
        { type: 'READ_PAGE', javascript: 'alert(1)' },
        { type: 'READ_PAGE', script: 'fetch("x")' },
        { type: 'SCROLL', direction: 'down', code: 'rm -rf' },
        { type: 'SCROLL', direction: 'down', eval: '()' },
        { type: 'FIND_TEXT', query: 'x', command: 'ls' },
        { type: 'CLICK_ELEMENT', target: { kind: 'stable-id', id: 'go' }, html: '<img>' },
        { type: 'TYPE_TEXT', target: { kind: 'stable-id', id: 'go' }, text: 'a', fn: 'f' },
      ];
      for (const candidate of hostile) {
        expect(parseActionCandidate(candidate)).toBeNull();
      }
    });

    it('rejects selector-shaped targets (no CSS/XPath ever)', () => {
      const hostile = [
        { kind: 'selector', selector: '.btn-primary' },
        { kind: 'css', text: '#login' },
        { kind: 'xpath', xpath: '//button[1]' },
        { kind: 'text', text: 'Go', selector: '.x' },
        { kind: 'role', role: 'button', name: 'Go', querySelector: '.x' },
      ];
      for (const target of hostile) {
        expect(
          parseActionCandidate({ type: 'CLICK_ELEMENT', target }),
        ).toBeNull();
      }
    });

    it('rejects SCROLL with invalid direction or oversized distance', () => {
      expect(parseActionCandidate({ type: 'SCROLL' })).toBeNull();
      expect(parseActionCandidate({ type: 'SCROLL', direction: 'left' })).toBeNull();
      expect(
        parseActionCandidate({
          type: 'SCROLL',
          direction: 'down',
          distancePx: ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX + 1,
        }),
      ).toBeNull();
      expect(
        parseActionCandidate({ type: 'SCROLL', direction: 'down', distancePx: -5 }),
      ).toBeNull();
      expect(
        parseActionCandidate({ type: 'SCROLL', direction: 'down', distancePx: '400' }),
      ).toBeNull();
    });

    it('rejects FIND_TEXT with missing or oversized query', () => {
      expect(parseActionCandidate({ type: 'FIND_TEXT' })).toBeNull();
      expect(parseActionCandidate({ type: 'FIND_TEXT', query: '' })).toBeNull();
      expect(
        parseActionCandidate({ type: 'FIND_TEXT', query: 'x'.repeat(ACTION_LIMITS.MAX_FIND_QUERY + 1) }),
      ).toBeNull();
      expect(
        parseActionCandidate({ type: 'FIND_TEXT', query: 'x', caseSensitive: 'yes' }),
      ).toBeNull();
    });

    it('rejects TYPE_TEXT with missing target/text or oversized text', () => {
      expect(parseActionCandidate({ type: 'TYPE_TEXT', text: 'hi' })).toBeNull();
      expect(
        parseActionCandidate({
          type: 'TYPE_TEXT',
          target: { kind: 'text', text: 'Name' },
        }),
      ).toBeNull();
      expect(
        parseActionCandidate({
          type: 'TYPE_TEXT',
          target: { kind: 'text', text: 'Name' },
          text: 'x'.repeat(ACTION_LIMITS.MAX_TEXT_LENGTH + 1),
        }),
      ).toBeNull();
    });

    it('rejects SELECT_OPTION with missing option', () => {
      expect(
        parseActionCandidate({
          type: 'SELECT_OPTION',
          target: { kind: 'text', text: 'Country' },
        }),
      ).toBeNull();
    });
  });

  describe('plan-level limits', () => {
    const scroll = { type: 'SCROLL', direction: 'down', distancePx: 100 };

    it('rejects empty or oversized plans', () => {
      expect(parseActionListCandidate([])).toBeNull();
      expect(
        parseActionListCandidate(
          Array.from({ length: ACTION_LIMITS.MAX_ACTIONS_PER_PLAN + 1 }, () => ({
            type: 'READ_PAGE',
          })),
        ),
      ).toBeNull();
    });

    it('accepts a plan at exactly the action cap', () => {
      const actions = Array.from(
        { length: ACTION_LIMITS.MAX_ACTIONS_PER_PLAN },
        () => ({ type: 'READ_PAGE' }),
      );
      expect(parseActionListCandidate(actions)).toHaveLength(
        ACTION_LIMITS.MAX_ACTIONS_PER_PLAN,
      );
    });

    it('enforces the scroll operation cap', () => {
      const tooMany = Array.from(
        { length: ACTION_LIMITS.MAX_SCROLL_OPERATIONS_PER_PLAN + 1 },
        () => scroll,
      );
      expect(parseActionListCandidate(tooMany)).toBeNull();
    });

    it('accepts scrolls exactly at the total-distance boundary', () => {
      // maxOperations × maxDistancePx == MAX_SCROLL_TOTAL_PX (the bound).
      const atBoundary = Array.from(
        { length: ACTION_LIMITS.MAX_SCROLL_OPERATIONS_PER_PLAN },
        () => ({
          type: 'SCROLL',
          direction: 'down',
          distancePx: ACTION_LIMITS.MAX_SCROLL_DISTANCE_PX,
        }),
      );
      expect(parseActionListCandidate(atBoundary)).toHaveLength(
        ACTION_LIMITS.MAX_SCROLL_OPERATIONS_PER_PLAN,
      );
    });

    it('rejects a plan containing one invalid action', () => {
      expect(
        parseActionListCandidate([
          { type: 'READ_PAGE' },
          { type: 'EXECUTE_JAVASCRIPT' },
        ]),
      ).toBeNull();
    });

    it('rejects non-array input', () => {
      expect(parseActionListCandidate({ type: 'READ_PAGE' })).toBeNull();
      expect(parseActionListCandidate('nope')).toBeNull();
    });
  });
});
