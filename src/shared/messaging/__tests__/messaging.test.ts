import { describe, expect, it } from 'vitest';
import {
  MESSAGE_VERSION,
  MessageType,
} from '../../constants/messages';
import { ErrorCode } from '../../constants/errors';
import { createMessage, createRequestId } from '../envelope';
import {
  parseMessage,
  parseMessageResult,
  toMessageFailure,
  toMessageResult,
} from '../validation';

describe('message envelope', () => {
  it('creates a versioned envelope with a request id', () => {
    const message = createMessage(MessageType.PING);
    expect(message.v).toBe(MESSAGE_VERSION);
    expect(message.type).toBe(MessageType.PING);
    expect(typeof message.id).toBe('string');
    expect(message.id.length).toBeGreaterThan(0);
    expect('payload' in message).toBe(false);
  });

  it('generates unique request ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createRequestId()));
    expect(ids.size).toBe(50);
  });

  it('parses a valid message and preserves its payload', () => {
    const raw = {
      v: 1,
      id: 'abc',
      type: MessageType.COMMAND_SUBMIT,
      payload: { text: 'hello', source: 'sidepanel' },
    };
    const parsed = parseMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe(MessageType.COMMAND_SUBMIT);
    expect(parsed?.payload).toEqual(raw.payload);
  });

  it.each([
    ['null', null],
    ['string', 'cl:ping'],
    ['number', 42],
    ['array', [1, 2, 3]],
    ['missing v', { id: 'x', type: MessageType.PING }],
    ['wrong v', { v: 99, id: 'x', type: MessageType.PING }],
    ['missing id', { v: 1, type: MessageType.PING }],
    ['empty id', { v: 1, id: '', type: MessageType.PING }],
    ['oversized id', { v: 1, id: 'x'.repeat(200), type: MessageType.PING }],
    ['missing type', { v: 1, id: 'x' }],
    ['unknown type', { v: 1, id: 'x', type: 'cl:unknown' }],
    ['non-string type', { v: 1, id: 'x', type: 7 }],
  ])('rejects a malformed message (%s)', (_name, raw) => {
    expect(parseMessage(raw)).toBeNull();
  });

  it('parses success and failure results', () => {
    expect(toMessageResult({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });

    const failure = toMessageFailure(ErrorCode.BAD_MESSAGE);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.code).toBe('BAD_MESSAGE');
      expect(failure.error.message.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed responses', () => {
    expect(parseMessageResult(null)).toBeNull();
    expect(parseMessageResult('ok')).toBeNull();
    expect(parseMessageResult({ ok: 'yes' })).toBeNull();
    expect(parseMessageResult({ ok: false })).toBeNull();
    expect(parseMessageResult({ ok: false, error: 'oops' })).toBeNull();
  });

  it('sanitizes unknown error codes in responses', () => {
    const parsed = parseMessageResult({
      ok: false,
      error: { code: 'SOMETHING_NEW', message: 'x'.repeat(500) },
    });
    expect(parsed).not.toBeNull();
    if (parsed && !parsed.ok) {
      expect(parsed.error.code).toBe('UNEXPECTED_ERROR');
      expect(parsed.error.message.length).toBeLessThanOrEqual(300);
    }
  });
});
