import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { executeActionStep, findTextMatches } from '../runtime';
import { ActionErrorCode } from '../types';

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head><title>Shop</title></head>
<body>
  <h1>Shop</h1>
  <p>Welcome to the shop. Pricing starts at zero. Pricing scales up.</p>
  <script>var hidden = "pricing";</script>
  <button id="menuBtn" aria-expanded="false">Menu</button>
  <button role="button" aria-label="Save changes">Save</button>
  <a href="/account">Account</a>
  <input id="city" aria-label="City" type="text" />
  <select id="country" aria-label="Country">
    <option value="in">India</option>
    <option value="de">Germany</option>
  </select>
  <!-- sensitive fields -->
  <input id="pw" type="password" aria-label="Password" />
  <input id="cc" autocomplete="cc-number" aria-label="Card number" type="text" />
  <input id="otp" name="otp_code" type="text" aria-label="One time code" />
  <input id="apikey" name="api_key" type="text" aria-label="API key" />
  <input id="pk" type="text" aria-label="Private key" />
  <input id="plain" name="firstname" type="text" aria-label="First name" />
</body>
</html>`;

let dom: JSDOM;
let doc: Document;

beforeEach(() => {
  dom = new JSDOM(FIXTURE_HTML, { url: 'https://example.com/shop' });
  doc = dom.window.document;
  vi.stubGlobal('document', doc);

  // Real click behavior for the state-change verification test.
  const menuBtn = doc.getElementById('menuBtn');
  menuBtn?.addEventListener('click', () => {
    menuBtn.setAttribute('aria-expanded', 'true');
  });

  // JSDOM has no layout engine: give every element a non-empty box and a
  // working scroll position so visibility/scroll checks behave like a
  // real browser.
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ x: 0, y: 0, width: 120, height: 32, top: 0, right: 120, bottom: 32, left: 0, toJSON: () => ({}) }) as DOMRect,
  );
  let scrollY = 0;
  Object.defineProperty(dom.window, 'scrollY', {
    get: () => scrollY,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(doc.documentElement, 'scrollHeight', {
    value: 10000,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'scrollTo', {
    value: (options?: ScrollToOptions) => {
      scrollY = Math.max(0, Math.min(Number(options?.top ?? 0), 10000 - 800));
    },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function step(action: unknown) {
  return executeActionStep(action, doc);
}

describe('content-side action runtime (Phase 4)', () => {
  describe('input validation at the DOM boundary', () => {
    it('rejects unknown, malformed, and executable payloads before any DOM work', () => {
      for (const hostile of [
        { type: 'EXECUTE_JAVASCRIPT', code: 'alert(1)' },
        { type: 'SHELL_COMMAND', command: 'ls' },
        { type: 'CLICK_ELEMENT', target: { kind: 'selector', selector: 'body' } },
        { type: 'CLICK_ELEMENT', target: { kind: 'xpath', xpath: '//' } },
        { type: 'SCROLL', direction: 'down', javascript: 'x' },
        { type: 'TYPE_TEXT', target: { kind: 'text', text: 'City' } },
        { type: 'READ_PAGE' }, // background-only action
        'not-an-object',
        null,
      ]) {
        const result = step(hostile);
        expect(result.ok, JSON.stringify(hostile)).toBe(false);
        if (!result.ok) {
          expect([
            ActionErrorCode.ACTION_INVALID,
            ActionErrorCode.ACTION_UNSUPPORTED,
          ]).toContain(result.error);
        }
      }
    });
  });

  describe('SCROLL', () => {
    it('scrolls down with clamped distance', () => {
      const result = step({ type: 'SCROLL', direction: 'down', distancePx: 600 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe('success');
        expect(result.result.message).toContain('Scrolled');
      }
      expect(dom.window.scrollY).toBe(600);
    });

    it('scrolls to the top (bounded, never negative)', () => {
      step({ type: 'SCROLL', direction: 'down', distancePx: 600 });
      const result = step({ type: 'SCROLL', direction: 'top' });
      expect(result.ok).toBe(true);
      expect(dom.window.scrollY).toBe(0);
    });

    it('scrolls to the bottom, clamped to the document height', () => {
      const result = step({ type: 'SCROLL', direction: 'bottom' });
      expect(result.ok).toBe(true);
      expect(dom.window.scrollY).toBe(10000 - 800);
    });
  });

  describe('FIND_TEXT (read-only, bounded)', () => {
    it('returns bounded matches with snippets and never mutates the page', () => {
      const bodyBefore = doc.body.innerHTML;
      const result = step({ type: 'FIND_TEXT', query: 'Pricing' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.result.data;
        expect(data?.kind).toBe('FIND_TEXT');
        if (data?.kind === 'FIND_TEXT') {
          expect(data.matchCount).toBe(2);
          expect(data.matches).toHaveLength(2);
          expect(data.matches[0]!.snippet).toContain('Pricing');
        }
      }
      expect(doc.body.innerHTML).toBe(bodyBefore); // no mutation
    });

    it('does not search inside script/style content', () => {
      const result = step({ type: 'FIND_TEXT', query: 'hidden' });
      expect(result.ok).toBe(true);
      if (result.ok && result.result.data?.kind === 'FIND_TEXT') {
        expect(result.result.data.matchCount).toBe(0);
      }
    });

    it('respects case sensitivity', () => {
      const ci = step({ type: 'FIND_TEXT', query: 'pricing' });
      const cs = step({ type: 'FIND_TEXT', query: 'pricing', caseSensitive: true });
      if (ci.ok && ci.result.data?.kind === 'FIND_TEXT') {
        expect(ci.result.data.matchCount).toBe(2);
      }
      if (cs.ok && cs.result.data?.kind === 'FIND_TEXT') {
        expect(cs.result.data.matchCount).toBe(0);
      }
    });

    it('caps the number of returned matches', () => {
      const many = findTextMatches('the', false, doc);
      expect(many.length).toBeLessThanOrEqual(25);
    });
  });

  describe('CLICK_ELEMENT', () => {
    it('clicks by visible text and verifies the state change', () => {
      const result = step({
        type: 'CLICK_ELEMENT',
        target: { kind: 'text', text: 'Menu' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe('success');
        expect(result.result.verification?.ok).toBe(true);
        expect(result.result.verification?.detail).toContain('state changed');
      }
      expect(doc.getElementById('menuBtn')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('clicks by role + accessible name', () => {
      const result = step({
        type: 'CLICK_ELEMENT',
        target: { kind: 'role', role: 'button', name: 'Save changes' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result.status).toBe('success');
    });

    it('clicks by stable id', () => {
      const result = step({
        type: 'CLICK_ELEMENT',
        target: { kind: 'stable-id', id: 'menuBtn' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result.status).toBe('success');
    });

    it('stops when the target cannot be found', () => {
      const result = step({
        type: 'CLICK_ELEMENT',
        target: { kind: 'text', text: 'No such button anywhere' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
      }
    });

    it('flags ambiguity when the requested occurrence exceeds matches', () => {
      const result = step({
        type: 'CLICK_ELEMENT',
        target: { kind: 'text', text: 'Menu', occurrence: 2 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ActionErrorCode.ACTION_TARGET_AMBIGUOUS);
      }
    });
  });

  describe('TYPE_TEXT', () => {
    it('types into a normal field, dispatches events, verifies boolean-only', () => {
      const events: string[] = [];
      const field = doc.getElementById('city') as HTMLInputElement;
      field.addEventListener('input', () => events.push('input'));
      field.addEventListener('change', () => events.push('change'));

      const result = step({
        type: 'TYPE_TEXT',
        target: { kind: 'role', role: 'textbox', name: 'City' },
        text: 'Pune',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe('success');
        expect(result.result.verification).toEqual({
          ok: true,
          detail: 'Field contains the expected value.',
        });
      }
      expect(field.value).toBe('Pune');
      expect(events).toEqual(['input', 'change']);
      // The RESPONSE never echoes the typed value.
      expect(JSON.stringify(result)).not.toContain('Pune');
    });

    for (const [label, target] of [
      ['password (type)', { kind: 'stable-id', id: 'pw' }],
      ['credit card (autocomplete)', { kind: 'stable-id', id: 'cc' }],
      ['OTP (name)', { kind: 'stable-id', id: 'otp' }],
      ['API key (name)', { kind: 'stable-id', id: 'apikey' }],
      ['private key (label)', { kind: 'stable-id', id: 'pk' }],
    ] as const) {
      it(`BLOCKS typing into a sensitive field — ${label}`, () => {
        const result = step({
          type: 'TYPE_TEXT',
          target: { ...target },
          text: 'super-secret-value',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.result.status).toBe('blocked');
          expect(result.result.message).toContain('never types into sensitive');
        }
        // The field is untouched and no value ever leaves the page.
        const el = doc.getElementById(target.id) as HTMLInputElement;
        expect(el.value).toBe('');
        expect(JSON.stringify(result)).not.toContain('super-secret-value');
      });
    }

    it('still types into non-sensitive fields', () => {
      const result = step({
        type: 'TYPE_TEXT',
        target: { kind: 'stable-id', id: 'plain' },
        text: 'Asha',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result.status).toBe('success');
      expect((doc.getElementById('plain') as HTMLInputElement).value).toBe('Asha');
    });

    it('refuses non-typeable targets', () => {
      const result = step({
        type: 'TYPE_TEXT',
        target: { kind: 'text', text: 'Menu' },
        text: 'x',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
      }
    });
  });

  describe('SELECT_OPTION', () => {
    it('selects by visible option label and verifies boolean-only', () => {
      const result = step({
        type: 'SELECT_OPTION',
        target: { kind: 'role', role: 'listbox', name: 'Country' },
        option: 'Germany',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.status).toBe('success');
        expect(result.result.verification?.ok).toBe(true);
      }
      expect((doc.getElementById('country') as HTMLSelectElement).value).toBe('de');
    });

    it('stops when the option label does not exist', () => {
      const result = step({
        type: 'SELECT_OPTION',
        target: { kind: 'stable-id', id: 'country' },
        option: 'Atlantis',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(ActionErrorCode.ACTION_TARGET_NOT_FOUND);
      }
    });
  });
});
