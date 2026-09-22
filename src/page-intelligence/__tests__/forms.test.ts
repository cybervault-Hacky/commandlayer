import { describe, expect, it } from 'vitest';
import { extractForms } from '../forms';
import { extractPageContext } from '../extractor';
import { PAGE_LIMITS } from '../limits';
import { createDocument } from './fixtures';

const ALLOWED_FIELD_KEYS = new Set(['name', 'type', 'label', 'required']);

function assertOnlyStructuralKeys(fields: Array<Record<string, unknown>>): void {
  for (const field of fields) {
    for (const key of Object.keys(field)) {
      expect(
        ALLOWED_FIELD_KEYS.has(key),
        `field key "${key}" is not structural`,
      ).toBe(true);
    }
    expect('value' in field).toBe(false);
  }
}

describe('extractForms (structural only)', () => {
  it('extracts action, method and structural fields with labels', () => {
    const { doc } = createDocument(
      `<html><body>
        <form method="post" action="/login">
          <label for="user">Username</label>
          <input id="user" name="username" type="text" required>
          <label for="plan">Choose plan</label>
          <select id="plan" name="plan"><option>a</option></select>
          <textarea name="bio" aria-label="Bio"></textarea>
          <label>Subscribe me
            <input type="checkbox" name="subscribe">
          </label>
          <input type="submit" value="Go">
        </form>
      </body></html>`,
    );
    const { forms } = extractForms(doc);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.method).toBe('post');
    expect(forms[0]?.action).toBe('/login');
    expect(forms[0]?.truncated).toBe(false);

    expect(forms[0]?.fields).toEqual([
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'plan', type: 'select', label: 'Choose plan', required: false },
      { name: 'bio', type: 'textarea', label: 'Bio', required: false },
      { name: 'subscribe', type: 'checkbox', label: 'Subscribe me', required: false },
      { type: 'text', required: false },
    ]);
  });

  it('normalizes unknown input types to a safe label', () => {
    const { doc } = createDocument(
      `<html><body><form>
        <input type="colorx" name="weird">
        <input name="no-type">
      </form></body></html>`,
    );
    const fields = extractForms(doc).forms[0]?.fields ?? [];
    expect(fields.map((f) => f.type)).toEqual(['text', 'text']);
    assertOnlyStructuralKeys(fields as unknown as Array<Record<string, unknown>>);
  });

  it('caps fields and reports truncation', () => {
    const fieldsHtml = Array.from(
      { length: PAGE_LIMITS.MAX_FORM_FIELDS + 5 },
      (_, i) => `<input name="f${i}" type="text">`,
    ).join('');
    const { doc } = createDocument(
      `<html><body><form>${fieldsHtml}</form></body></html>`,
    );
    const { forms, truncated } = extractForms(doc);
    expect(forms[0]?.fields).toHaveLength(PAGE_LIMITS.MAX_FORM_FIELDS);
    expect(forms[0]?.truncated).toBe(true);
    expect(truncated).toBe(true);
  });

  it('caps the number of forms and reports truncation', () => {
    const many = Array.from(
      { length: PAGE_LIMITS.MAX_FORMS + 3 },
      () => `<form><input name="x" type="text"></form>`,
    ).join('');
    const { doc } = createDocument(`<html><body>${many}</body></html>`);
    const { forms, truncated } = extractForms(doc);
    expect(forms).toHaveLength(PAGE_LIMITS.MAX_FORMS);
    expect(truncated).toBe(true);
  });

  /* ------------------------------------------------------------------ */
  /* REQUIRED REGRESSION: input values are NEVER collected.             */
  /* ------------------------------------------------------------------ */

  it('REGRESSION: never includes values for password, email, card-like, OTP or hidden inputs', () => {
    const { doc } = createDocument(
      `<html><body>
        <form method="post" action="/checkout">
          <input type="password" name="password" value="SECRET">
          <input type="email" name="email" value="user@example.com">
          <input type="tel" name="card" value="4111111111111111">
          <input type="text" name="otp" value="123456" inputmode="numeric">
          <input type="hidden" name="session" value="session-token-abc-123">
          <input type="hidden" name="csrf" value="csrf-xyz">
          <textarea name="notes">private draft notes</textarea>
          <input type="checkbox" name="subscribe" checked>
        </form>
      </body></html>`,
    );

    const { forms } = extractForms(doc);
    expect(forms).toHaveLength(1);
    const fields = forms[0]?.fields ?? [];
    assertOnlyStructuralKeys(fields as unknown as Array<Record<string, unknown>>);

    const byName = new Map(fields.map((f) => [f.name, f] as const));

    // Password: shown as type only — never its value.
    expect(byName.get('password')).toEqual({
      name: 'password',
      type: 'password',
      required: false,
    });
    expect(byName.get('email')?.type).toBe('email');
    expect(byName.get('card')?.type).toBe('tel');
    expect(byName.get('otp')?.type).toBe('text');
    expect(byName.get('session')?.type).toBe('hidden');
    expect(byName.get('csrf')?.type).toBe('hidden');
    expect(byName.get('subscribe')?.type).toBe('checkbox');

    // The full serialized form must not contain a single secret.
    const json = JSON.stringify(forms);
    for (const secret of [
      'SECRET',
      'user@example.com',
      '4111111111111111',
      '123456',
      'session-token-abc-123',
      'csrf-xyz',
      'private draft notes',
    ]) {
      expect(json, `must not contain "${secret}"`).not.toContain(secret);
    }
  });

  it('REGRESSION: full PageContext extraction never leaks form values', () => {
    const { doc } = createDocument(
      `<html><body>
        <form>
          <input type="password" name="pw" value="hunter2secret">
          <input type="text" name="token" value="Bearer-abc-123">
        </form>
      </body></html>`,
    );
    const context = extractPageContext(doc);
    const json = JSON.stringify(context);
    expect(json).not.toContain('hunter2secret');
    expect(json).not.toContain('Bearer-abc-123');
    expect(context.forms[0]?.fields?.[0]).toMatchObject({
      name: 'pw',
      type: 'password',
    });
  });
});
