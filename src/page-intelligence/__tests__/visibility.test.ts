import { describe, expect, it } from 'vitest';
import { isElementVisible, isInsideNonRenderedElement } from '../visibility';
import { createDocument } from './fixtures';

describe('visibility detection', () => {
  it('treats normal content elements as visible', () => {
    const { doc } = createDocument(`<html><body><p>hi</p></body></html>`);
    expect(isElementVisible(doc.querySelector('p')!)).toBe(true);
  });

  it.each([
    ['display:none', `<p style="display:none">x</p>`],
    ['visibility:hidden', `<p style="visibility:hidden">x</p>`],
    ['[hidden]', `<p hidden>x</p>`],
    ['aria-hidden', `<p aria-hidden="true">x</p>`],
    ['inside display:none ancestor', `<div style="display:none"><p>x</p></div>`],
    ['template', `<template><p>x</p></template>`],
    ['script', `<script>var x;</script>`],
    ['noscript', `<noscript>x</noscript>`],
    ['svg', `<svg><text>x</text></svg>`],
  ])('marks %s as not visible', (_label, fragment) => {
    const { doc } = createDocument(`<html><body>${fragment}</body></html>`);
    const el = doc.body.firstElementChild as Element;
    expect(isElementVisible(el)).toBe(false);
  });

  it('keeps an element visible when a parent uses aria-hidden false', () => {
    const { doc } = createDocument(
      `<html><body><div aria-hidden="false"><p>x</p></div></body></html>`,
    );
    expect(isElementVisible(doc.querySelector('p')!)).toBe(true);
  });

  it('detects non-rendered ancestors via closest()', () => {
    const { doc } = createDocument(
      `<html><body><div><style>.a{}</style></div><p>x</p></body></html>`,
    );
    expect(isInsideNonRenderedElement(doc.querySelector('style')!)).toBe(true);
    expect(isInsideNonRenderedElement(doc.querySelector('p')!)).toBe(false);
  });

  it('excludes zero-size elements when layout metrics exist', () => {
    const { doc, win } = createDocument(
      `<html><body data-test-width="800" data-test-height="600">
        <p data-test-width="400" data-test-height="20">ok</p>
        <p data-test-width="0" data-test-height="0">gone</p>
      </body></html>`,
    );
    Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.testWidth ?? 0);
      },
    });
    Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.testHeight ?? 0);
      },
    });
    const ok = doc.querySelectorAll('p')[0]!;
    const gone = doc.querySelectorAll('p')[1]!;
    expect(isElementVisible(ok)).toBe(true);
    expect(isElementVisible(gone)).toBe(false);
  });

  it('skips the zero-size check when layout metrics are unavailable (jsdom default)', () => {
    // jsdom reports offsetWidth 0 for everything; the probe must treat that
    // as "no layout" and keep elements visible.
    const { doc } = createDocument(`<html><body><p>still visible</p></body></html>`);
    expect(isElementVisible(doc.querySelector('p')!)).toBe(true);
  });
});
