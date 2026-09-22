/**
 * Phase 4 — centralized sensitive-field detection (defense in depth).
 *
 * The executor must NEVER type into sensitive inputs, even when a plan
 * requests it. This module is a conservative classifier: when uncertain
 * it returns true (BLOCK). It never reads or returns field values.
 */

/** Input types that are always sensitive. */
const SENSITIVE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'password',
]);

/** `autocomplete` tokens that mark a field as sensitive. */
const SENSITIVE_AUTOCOMPLETE_TOKENS: readonly string[] = [
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-name',
  'cc-family-name',
  'cc-given-name',
  'cc-type',
  'transaction-amount',
  'transaction-currency',
  'street-address',
];

/**
 * Keyword heuristic over id / name / label / placeholder / aria-label.
 * Deliberately broad — false positives block the action (safe), false
 * negatives are caught by the type/autocomplete checks above where
 * possible.
 */
const SENSITIVE_KEYWORDS: readonly string[] = [
  'password',
  'passwd',
  'credit card',
  'creditcard',
  'card number',
  'cardnumber',
  'cvv',
  'cvc',
  'csc',
  'card security',
  'security code',
  'expiry',
  'otp',
  'one-time',
  'one time code',
  'verification code',
  'auth code',
  'authentication code',
  '2fa',
  'bank',
  'account number',
  'routing number',
  'iban',
  'swift',
  'private key',
  'api key',
  'apikey',
  'api_key',
  'secret',
  'token',
  'ssn',
  'social security',
  'pin',
];

export interface SensitiveFieldSignals {
  inputType?: string | null;
  autocomplete?: string | null;
  /** Concatenated id / name / placeholder / aria-label / nearby label. */
  descriptors?: string | null;
}

/** Conservative classifier: true = treat as sensitive and BLOCK. */
export function isSensitiveField(signals: SensitiveFieldSignals): boolean {
  const type = (signals.inputType ?? '').toLowerCase();
  if (SENSITIVE_INPUT_TYPES.has(type)) return true;

  const autocomplete = (signals.autocomplete ?? '').toLowerCase();
  if (autocomplete.length > 0) {
    for (const token of SENSITIVE_AUTOCOMPLETE_TOKENS) {
      if (autocomplete.includes(token)) return true;
    }
  }

  const descriptors = (signals.descriptors ?? '').toLowerCase();
  if (descriptors.length > 0) {
    for (const keyword of SENSITIVE_KEYWORDS) {
      if (descriptors.includes(keyword)) return true;
    }
  }

  return false;
}

/**
 * User-safe block wording. Never echoes the field identity beyond its
 * coarse kind — no ids, names, or values.
 */
export const SENSITIVE_FIELD_MESSAGE =
  'CommandLayer never types into sensitive fields such as passwords or payment details.';
