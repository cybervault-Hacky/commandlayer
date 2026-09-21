import { describe, expect, it } from 'vitest';
import { displayHostname, sanitizeText } from '../security/sanitize';
import { isUnsupportedPageUrl, parseSafeUrl } from '../security/url';
import {
  CommandLayerError,
  toUserFacingError,
} from '../security/errors';
import { ErrorCode } from '../constants/errors';

describe('parseSafeUrl', () => {
  it('accepts http/https URLs', () => {
    const url = parseSafeUrl('https://github.com/repo');
    expect(url).not.toBeNull();
    expect(url?.hostname).toBe('github.com');
    expect(url?.protocol).toBe('https:');
    expect(url?.origin).toBe('https://github.com');
  });

  it('rejects unsafe schemes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com',
    ]) {
      expect(parseSafeUrl(bad), bad).toBeNull();
    }
  });

  it('rejects garbage input', () => {
    for (const bad of [null, 42, [], {}, '', '   ']) {
      expect(parseSafeUrl(bad)).toBeNull();
    }
  });

  it('rejects overlong URLs', () => {
    expect(parseSafeUrl(`https://x.com/${'a'.repeat(3000)}`)).toBeNull();
  });

  it('classifies internal pages as unsupported, not safe', () => {
    expect(isUnsupportedPageUrl('chrome://extensions')).toBe(true);
    expect(isUnsupportedPageUrl('edge://newtab/')).toBe(true);
    expect(isUnsupportedPageUrl('https://example.com')).toBe(false);
    expect(isUnsupportedPageUrl(123)).toBe(false);
  });
});

describe('sanitizeText', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeText('a\u0000b\u0007  c\t\nd', 100)).toBe('ab c d');
  });

  it('truncates with an ellipsis', () => {
    const out = sanitizeText('a'.repeat(200), 50);
    expect(out).not.toBeNull();
    expect(out?.length).toBe(50);
    expect(out?.endsWith('…')).toBe(true);
  });

  it('returns null for empty or non-string input', () => {
    expect(sanitizeText('   ', 10)).toBeNull();
    expect(sanitizeText(undefined, 10)).toBeNull();
    expect(sanitizeText(7, 10)).toBeNull();
  });
});

describe('displayHostname', () => {
  it('lowercases, drops ports and leading www', () => {
    expect(displayHostname('WWW.Example.COM:8080')).toBe('example.com');
    expect(displayHostname('GitHub.com')).toBe('github.com');
  });
});

describe('toUserFacingError', () => {
  it('preserves safe CommandLayerErrors', () => {
    const error = new CommandLayerError(
      ErrorCode.EMPTY_COMMAND,
      'Enter a command first.',
    );
    expect(toUserFacingError(error)).toEqual({
      code: 'EMPTY_COMMAND',
      message: 'Enter a command first.',
    });
  });

  it('never leaks details of unknown errors', () => {
    expect(toUserFacingError(new Error('secret stack trace!'))).toEqual({
      code: 'UNEXPECTED_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    expect(toUserFacingError('random string')).toMatchObject({
      code: 'UNEXPECTED_ERROR',
    });
  });
});
