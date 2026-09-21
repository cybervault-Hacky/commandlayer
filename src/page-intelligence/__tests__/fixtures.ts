/**
 * JSDOM fixtures for Page Intelligence tests. Each fixture gets its own
 * window/document so URL, selection and layout overrides never leak.
 */
import { JSDOM, type DOMWindow } from 'jsdom';

export function createDocument(
  html: string,
  url = 'https://example.com/article',
): { doc: Document; win: DOMWindow } {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  return { doc: dom.window.document, win: dom.window };
}

/** A rich, realistic page exercising every extractor. */
export const RICH_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Example Article</title>
  <meta name="description" content="A fixture article for extraction tests.">
  <link rel="canonical" href="/canonical-article">
</head>
<body>
  <header><p>Site header boilerplate</p></header>
  <nav>
    <p>Navigation boilerplate</p>
    <a href="/about">About</a>
  </nav>
  <article>
    <h1>Main Title</h1>
    <h2>Section One</h2>
    <p>First meaningful paragraph about the subject.</p>
    <p>Second paragraph with more detail.</p>
    <h3>Subsection</h3>
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
    <h4>Deep note</h4>
    <p>  Whitespace   heavy   text   </p>
    <p style="display:none">Hidden display none</p>
    <table>
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>alpha</td><td>1</td></tr>
        <tr><td></td><td>2</td></tr>
      </tbody>
    </table>
    <a href="/relative-link">Relative</a>
    <a href="https://example.com/absolute-link">Absolute</a>
    <a href="https://example.com/absolute-link">Duplicate</a>
    <a href="javascript:void(0)">Unsafe</a>
  </article>
  <footer><p>Footer boilerplate</p></footer>
</body>
</html>`;
