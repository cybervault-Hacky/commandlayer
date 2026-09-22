import { describe, expect, it } from 'vitest';
import { isSensitiveField, SENSITIVE_FIELD_MESSAGE } from '../sensitive';

describe('sensitive field classifier (Phase 4)', () => {
  it('always blocks password inputs by type', () => {
    expect(isSensitiveField({ inputType: 'password' })).toBe(true);
    expect(isSensitiveField({ inputType: 'PASSWORD' })).toBe(true);
  });

  it('blocks by autocomplete tokens', () => {
    for (const token of [
      'current-password',
      'new-password',
      'one-time-code',
      'cc-number',
      'cc-csc',
      'transaction-amount',
      'section-blue cc-exp',
    ]) {
      expect(isSensitiveField({ autocomplete: token })).toBe(true);
    }
  });

  it('blocks by descriptor keywords (payment, codes, keys, secrets)', () => {
    const descriptors = [
      'Credit card number',
      'cardnumber input',
      'CVV',
      'security code',
      'OTP code',
      'one-time password',
      'verification code',
      'Bank account number',
      'routing number',
      'IBAN',
      'Private key',
      'API key',
      'api_key field',
      'Secret token',
      'auth token',
      'SSN',
      'Social Security Number',
      'PIN entry',
      'login password',
    ];
    for (const descriptor of descriptors) {
      expect(
        isSensitiveField({ descriptors: descriptor }),
        `expected "${descriptor}" to be sensitive`,
      ).toBe(true);
    }
  });

  it('allows ordinary fields', () => {
    for (const signals of [
      { inputType: 'text', descriptors: 'First name' },
      { inputType: 'email', descriptors: 'Email address' },
      { inputType: 'search', descriptors: 'Search the site' },
      { inputType: 'text', autocomplete: 'name', descriptors: 'Full name' },
      { inputType: 'textarea', descriptors: 'Comment' },
      {},
    ]) {
      expect(isSensitiveField(signals)).toBe(false);
    }
  });

  it('never includes values or secrets in the block message', () => {
    expect(SENSITIVE_FIELD_MESSAGE).not.toMatch(/password:|value|secret key:/i);
    expect(SENSITIVE_FIELD_MESSAGE.length).toBeGreaterThan(10);
  });
});
