/**
 * Service-worker smoke test for the PRODUCTION build.
 *
 * Loads dist/background.js in Node with a minimal chrome.* shim and drives
 * it through real message round-trips (ping, status, page context, command
 * pipeline, malformed-message rejection). This validates that the built
 * worker evaluates and behaves correctly without a browser.
 *
 * Usage: npm run smoke   (run `npm run build` first)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function assert(condition, label) {
  if (!condition) {
    console.error(`SMOKE FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

// --- dist sanity ----------------------------------------------------------
for (const file of [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'sidepanel.html',
  'command-center.html',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
]) {
  assert(existsSync(join(dist, file)), `dist/${file} exists`);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
assert(manifest.manifest_version === 3, 'manifest is Manifest V3');
assert(manifest.background?.service_worker === 'background.js', 'worker path correct');
assert(manifest.background?.type === 'module', 'worker is a module');
assert(manifest.action?.default_popup === 'popup.html', 'popup wired');
assert(manifest.side_panel?.default_path === 'sidepanel.html', 'side panel wired');

// Phase 2: content script registered for http/https pages only.
const contentScripts = manifest.content_scripts ?? [];
assert(contentScripts.length === 1, 'content script registered');
assert(
  JSON.stringify(contentScripts[0]?.matches) === JSON.stringify(['http://*/*', 'https://*/*']),
  'content script matches only http/https pages',
);
assert(
  contentScripts[0]?.js?.[0] === 'content.js',
  'content script bundle wired',
);
const contentBundle = readFileSync(join(dist, 'content.js'), 'utf8');
assert(
  contentBundle.includes('cl:extract-page-context-request'),
  'content bundle speaks the extraction protocol',
);
assert(!/fetch\(|XMLHttpRequest/.test(contentBundle), 'content bundle makes no network calls');

// HTML pages reference assets that exist
for (const page of ['popup.html', 'sidepanel.html', 'command-center.html']) {
  const html = readFileSync(join(dist, page), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.js|[^"]+\.css)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    assert(
      existsSync(join(dist, ref.replace(/^\.\//, ''))),
      `${page} -> ${ref} exists`,
    );
  }
}

// --- simulated web page (jsdom) + REAL content bundle -----------------------
// The smoke test loads the PRODUCTION content script (dist/content.js) into a
// jsdom window with a small page fixture. `tabs.sendMessage` then forwards
// the background's real request to that real listener, and the background
// validates the real extraction result. Everything except the browser is the
// actual shipped code.
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>GitHub</title>
  <meta name="description" content="Let anyone and anything generate and version code on GitHub.">
  <link rel="canonical" href="https://github.com/">
</head>
<body>
  <nav><a href="/pricing">Pricing</a></nav>
  <article>
    <h1>GitHub</h1>
    <h2>For the world's code</h2>
    <p>Git code hosting platform with code review, issues, pull requests, and CI.</p>
    <p>Build, ship, and manage software alongside your team.</p>
    <ul>
      <li>Repositories</li>
      <li>Actions</li>
    </ul>
    <table>
      <thead><tr><th>Repository</th><th>Stars</th></tr></thead>
      <tbody>
        <tr><td>octocat/Hello-World</td><td>120</td></tr>
        <tr><td>github/docs</td><td>87</td></tr>
      </tbody>
    </table>
    <form method="post" action="/session">
      <input type="text" name="login" aria-label="Username">
      <input type="password" name="password" aria-label="Password">
    </form>
    <a href="/features">Features</a>
    <a href="https://github.com/features">Features (dup)</a>
    <a href="https://github.com/enterprise">Enterprise</a>
    <script>var shouldNeverAppear = "tracking";</script>
    <p style="display:none">Hidden text that must not be extracted</p>
  </article>
</body>
</html>`;

const dom = new JSDOM(PAGE_HTML, { url: 'https://github.com/', runScripts: 'outside-only' });
let contentListener = null;
dom.window.chrome = {
  runtime: {
    id: 'smoke-test-extension',
    onMessage: {
      addListener: (fn) => {
        contentListener = fn;
      },
    },
  },
};
dom.window.eval(readFileSync(join(dist, 'content.js'), 'utf8'));
assert(typeof contentListener === 'function', 'content script registered its listener');

// --- chrome shim ------------------------------------------------------------
const listeners = {};
const manifestData = manifest;
globalThis.chrome = {
  runtime: {
    id: 'smoke-test-extension',
    getManifest: () => manifestData,
    getURL: (path) => `chrome-extension://smoke-test-extension/${path}`,
    onMessage: { addListener: (fn) => { listeners.onMessage = fn; } },
    onInstalled: { addListener: (fn) => { listeners.onInstalled = fn; } },
  },
  commands: { onCommand: { addListener: (fn) => { listeners.onCommand = fn; } } },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
  tabs: {
    query: async () => [{ id: 1, title: 'GitHub', url: 'https://github.com/' }],
    create: async () => ({ id: 99 }),
    // Simulate the browser delivering the message to the page's content
    // script (the REAL dist/content.js listener).
    sendMessage: async (_tabId, message) => {
      let response = undefined;
      contentListener(message, { id: 'smoke-test-extension' }, (r) => {
        response = r;
      });
      if (response === undefined) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return response;
    },
  },
  permissions: { contains: async () => ({ hasPermission: true }) },
  sidePanel: { open: async () => {} },
  windows: { getCurrent: async () => ({ id: 1 }) },
};

// --- load the built worker ----------------------------------------------------
await import(join(dist, 'background.js'));

assert(typeof listeners.onMessage === 'function', 'onMessage listener registered');
assert(typeof listeners.onInstalled === 'function', 'onInstalled listener registered');
assert(typeof listeners.onCommand === 'function', 'onCommand listener registered');

const sender = { id: 'smoke-test-extension' };

const ping = await listeners.onMessage({ v: 1, id: 's1', type: 'cl:ping' }, sender);
assert(ping.ok === true, 'PING resolves ok');
assert(ping.data?.pong === true, 'PING payload correct');
assert(ping.data?.version === '0.1.0', 'PING reports version');

const status = await listeners.onMessage(
  { v: 1, id: 's2', type: 'cl:get-extension-status' },
  sender,
);
assert(status.ok === true, 'GET_EXTENSION_STATUS resolves ok');
assert(status.data?.environment === 'extension', 'environment detected as extension');
assert(status.data?.version === '0.1.0', 'status version matches manifest');

const page = await listeners.onMessage(
  { v: 1, id: 's3', type: 'cl:get-current-page' },
  sender,
);
assert(page.ok === true, 'GET_CURRENT_PAGE resolves ok');
assert(page.data?.state === 'ready', 'page context ready');
assert(page.data?.hostname === 'github.com', 'page hostname extracted');
assert(page.data?.title === 'GitHub', 'page title extracted');

const pageContext = await listeners.onMessage(
  { v: 1, id: 's3b', type: 'cl:get-page-context' },
  sender,
);
assert(pageContext.ok === true, 'GET_PAGE_CONTEXT resolves ok');
assert(pageContext.data?.state === 'ready', 'page context captured as ready');
assert(pageContext.data?.title === 'GitHub', 'context title read from document');
assert(pageContext.data?.description, 'meta description captured');
assert(pageContext.data?.language === 'en', 'document language captured');
assert(pageContext.data?.canonicalUrl === 'https://github.com/', 'canonical URL captured');
assert(pageContext.data?.headings?.length === 2, 'headings captured (H1 + H2)');
assert(pageContext.data?.paragraphs?.length === 4, 'visible paragraphs captured');
const contextJson = JSON.stringify(pageContext.data ?? {});
assert(!contextJson.includes('Hidden text'), 'display:none text excluded');
assert(!contextJson.includes('tracking'), 'script content excluded');
assert(pageContext.data?.links?.length === 3, 'links normalized and de-duplicated');
assert(pageContext.data?.tables?.length === 1, 'table captured');
const passwordField = pageContext.data?.forms?.[0]?.fields?.find(
  (f) => f?.type === 'password',
);
assert(!!passwordField, 'password field present (structural)');
assert(
  Object.keys(passwordField).sort().join(',') === 'label,name,required,type',
  'password field exposes NO value key',
);
assert(!/["']value["']/.test(contextJson), 'no "value" key anywhere in context');
assert(typeof pageContext.data?.contentHash === 'string', 'lightweight content hash present');

const subset = await listeners.onMessage(
  {
    v: 1,
    id: 's3c',
    type: 'cl:get-page-context',
    payload: { sections: ['metadata', 'headings'] },
  },
  sender,
);
assert(subset.ok === true, 'subset GET_PAGE_CONTEXT resolves ok');
assert(subset.data?.headings?.length === 2, 'subset still extracts requested sections');
assert(subset.data?.paragraphs?.length === 0, 'subset does not extract unrequested sections');

const badSections = await listeners.onMessage(
  { v: 1, id: 's3d', type: 'cl:get-page-context', payload: { sections: ['hacks'] } },
  sender,
);
assert(badSections.ok === false, 'invalid sections rejected');
assert(badSections.error?.code === 'INVALID_PAYLOAD', 'invalid sections code correct');

const command = await listeners.onMessage(
  {
    v: 1,
    id: 's4',
    type: 'cl:command-submit',
    payload: { text: 'Summarize this page', source: 'sidepanel' },
  },
  sender,
);
assert(command.ok === true, 'COMMAND_SUBMIT resolves ok');
assert(command.data?.status === 'completed', 'command completed');
assert(
  command.data?.text?.includes('Page context captured successfully'),
  'command received real page context via the engine',
);
assert(
  command.data?.text?.includes('AI reasoning engine will be connected in a future phase'),
  'result does not pretend AI ran',
);

const quick = await listeners.onMessage(
  {
    v: 1,
    id: 's5',
    type: 'cl:quick-action',
    payload: { actionId: 'compare', source: 'command-center' },
  },
  sender,
);
assert(quick.ok === true, 'QUICK_ACTION resolves ok');
assert(quick.data?.quickAction === 'compare', 'quick action recorded');

const settings = await listeners.onMessage(
  { v: 1, id: 's6', type: 'cl:set-settings', payload: { patch: { theme: 'light' } } },
  sender,
);
assert(settings.ok === true, 'SET_SETTINGS resolves ok');
assert(settings.data?.theme === 'light', 'settings updated');

const malformed = await listeners.onMessage('garbage', sender);
assert(malformed.ok === false, 'malformed message rejected');
assert(malformed.error?.code === 'BAD_MESSAGE', 'malformed message code correct');

const untrusted = await listeners.onMessage(
  { v: 1, id: 's7', type: 'cl:ping' },
  { id: 'another-extension' },
);
assert(untrusted.ok === false, 'untrusted sender rejected');
assert(untrusted.error?.code === 'UNAUTHORIZED_SENDER', 'untrusted sender code correct');

const unknown = await listeners.onMessage(
  { v: 1, id: 's8', type: 'cl:unknown' },
  sender,
);
assert(unknown.ok === false, 'unknown message type rejected');

const emptyCommand = await listeners.onMessage(
  {
    v: 1,
    id: 's9',
    type: 'cl:command-submit',
    payload: { text: '   ', source: 'sidepanel' },
  },
  sender,
);
assert(emptyCommand.ok === true, 'empty command answered as a result');
assert(emptyCommand.data?.status === 'failed', 'empty command marked failed');
assert(
  emptyCommand.data?.errorCode === 'EMPTY_COMMAND',
  'empty command carries EMPTY_COMMAND code',
);

console.log('\nWorker smoke test: all checks passed.');
