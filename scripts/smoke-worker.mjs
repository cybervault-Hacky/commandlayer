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
  command.data?.text?.includes('Command received'),
  'command result text is the honest Phase 1 response',
);
assert(
  command.data?.text?.includes('AI intelligence will be connected'),
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
