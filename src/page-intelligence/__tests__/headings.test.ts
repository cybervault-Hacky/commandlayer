import { describe, expect, it } from 'vitest';
import { extractHeadings } from '../headings';
import { PAGE_LIMITS } from '../limits';
import { createDocument } from './fixtures';

describe('extractHeadings', () => {
  it('extracts H1-H4 in document order, preserving level', () => {
    const { doc } = createDocument(
      `<html><body>
        <h1>Top</h1>
        <h3>Skip to three</h3>
        <h2>Two</h2>
        <h4>Four</h4>
      </body></html>`,
    );
    const { headings } = extractHeadings(doc);
    expect(headings).toEqual([
      { level: 1, text: 'Top' },
      { level: 3, text: 'Skip to three' },
      { level: 2, text: 'Two' },
      { level: 4, text: 'Four' },
    ]);
  });

  it('ignores H5+ and empty or whitespace-only headings', () => {
    const { doc } = createDocument(
      `<html><body>
        <h5>Not collected</h5>
        <h1></h1>
        <h2>   </h2>
        <h3>Real</h3>
      </body></html>`,
    );
    expect(extractHeadings(doc).headings).toEqual([{ level: 3, text: 'Real' }]);
  });

  it('ignores hidden headings (display:none and aria-hidden)', () => {
    const { doc } = createDocument(
      `<html><body>
        <h1 style="display:none">Hidden</h1>
        <h2 aria-hidden="true">Aria hidden</h2>
        <h3 visible>Visible</h3>
      </body></html>`,
    );
    expect(extractHeadings(doc).headings).toEqual([{ level: 3, text: 'Visible' }]);
  });

  it('trims and normalizes heading text', () => {
    const { doc } = createDocument(
      `<html><body><h1>  Spaced   Out  </h1></body></html>`,
    );
    expect(extractHeadings(doc).headings).toEqual([{ level: 1, text: 'Spaced Out' }]);
  });

  it('caps the number of headings and reports truncation', () => {
    const many = Array.from(
      { length: PAGE_LIMITS.MAX_HEADINGS + 10 },
      (_, i) => `<h2>H${i}</h2>`,
    ).join('');
    const { doc } = createDocument(`<html><body>${many}</body></html>`);
    const { headings, truncated } = extractHeadings(doc);
    expect(headings).toHaveLength(PAGE_LIMITS.MAX_HEADINGS);
    expect(truncated).toBe(true);
  });
});
