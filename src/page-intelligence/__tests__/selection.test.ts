import { describe, expect, it } from 'vitest';
import { extractSelection } from '../selection';
import { PAGE_LIMITS } from '../limits';
import { createDocument } from './fixtures';
import type { DOMWindow } from 'jsdom';

function stubSelection(win: DOMWindow, text: string | null): void {
  const fakeSelection = {
    rangeCount: text === null ? 0 : 1,
    toString: () => text ?? '',
  };
  Object.defineProperty(win, 'getSelection', {
    configurable: true,
    value: () => fakeSelection,
  });
}

describe('extractSelection (on-demand only)', () => {
  it('returns null when nothing is selected', () => {
    const { doc, win } = createDocument(`<html><body><p>text</p></body></html>`);
    stubSelection(win, null);
    const { text, truncated } = extractSelection(doc);
    expect(text).toBeNull();
    expect(truncated).toBe(false);
  });

  it('reads and sanitizes the current selection', () => {
    const { doc, win } = createDocument(`<html><body><p>text</p></body></html>`);
    stubSelection(win, '   selected    text  ');
    const { text, truncated } = extractSelection(doc);
    expect(text).toBe('selected text');
    expect(truncated).toBe(false);
  });

  it('caps selection length and reports truncation', () => {
    const { doc, win } = createDocument(`<html><body><p>text</p></body></html>`);
    stubSelection(win, 'x'.repeat(PAGE_LIMITS.MAX_SELECTED_TEXT + 500));
    const { text, truncated } = extractSelection(doc);
    expect(truncated).toBe(true);
    expect(text?.length).toBeLessThanOrEqual(PAGE_LIMITS.MAX_SELECTED_TEXT);
  });

  it('returns null when the selection API throws (hostile page)', () => {
    const { doc, win } = createDocument(`<html><body><p>text</p></body></html>`);
    Object.defineProperty(win, 'getSelection', {
      configurable: true,
      value: () => {
        throw new Error('boom');
      },
    });
    const { text } = extractSelection(doc);
    expect(text).toBeNull();
  });
});
