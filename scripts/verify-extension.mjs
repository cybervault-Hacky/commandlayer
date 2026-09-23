/**
 * Publishable-extension verifier.
 *
 * Validates that `extension/` is a complete, self-contained, load-unpacked
 * ready Manifest V3 extension without running it:
 *
 *   1. manifest.json parses and is a valid MV3 manifest
 *   2. no forbidden/extra permissions, no host permissions
 *   3. every manifest-referenced path exists and is non-empty
 *      (service worker, content script, popup, side panel, icons)
 *   4. every HTML asset reference resolves
 *   5. icons are real, non-trivial PNGs; bundles are substantial
 *   6. no development files, tests, or source maps are shipped
 *   7. no secret material is present in any shipped text file
 *   8. nothing unexpected is shipped (only referenced files, assets/, icons/)
 *
 * Usage: npm run verify:extension   (run `npm run build` first)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'extension',
);

const FORBIDDEN_PERMISSIONS = new Set([
  '<all_urls>',
  'cookies',
  'history',
  'debugger',
  'nativeMessaging',
  'management',
  'webRequest',
  'downloads',
  'clipboardRead',
  'geolocation',
  'tabCapture',
]);

const DEV_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'eslint.config.js',
  'vitest.config.ts',
  'vitest.setup.ts',
  'vite.config.ts',
  'vite.config.worker.ts',
  'vite.config.content.ts',
  '.env',
  '.env.example',
  '.gitignore',
];

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z\-_]{30,}/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{24,}/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * Verify a built extension folder.
 * @returns {{ problems: string[], facts: Record<string, unknown> }}
 */
export function verifyExtension(dir = EXTENSION_DIR) {
  const problems = [];
  const check = (condition, label) => {
    if (!condition) problems.push(label);
    return Boolean(condition);
  };
  const facts = {
    dir,
    name: null,
    version: null,
    permissions: [],
    manifestReferences: 0,
    htmlReferences: 0,
    files: 0,
    icons: 0,
  };

  const manifestPath = join(dir, 'manifest.json');
  if (!check(existsSync(manifestPath), 'manifest.json exists')) {
    return { problems, facts };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    problems.push('manifest.json is valid JSON');
    return { problems, facts };
  }

  facts.name = manifest.name ?? null;
  facts.version = manifest.version ?? null;
  facts.permissions = manifest.permissions ?? [];

  check(manifest.manifest_version === 3, 'manifest is Manifest V3');
  check(
    typeof manifest.name === 'string' && manifest.name.length > 0,
    'manifest declares a name',
  );
  check(
    /^\d+\.\d+\.\d+$/.test(manifest.version ?? ''),
    'manifest version is semver',
  );
  check(
    typeof manifest.description === 'string' && manifest.description.length > 0,
    'manifest declares a description',
  );
  check(
    !facts.permissions.some((permission) => FORBIDDEN_PERMISSIONS.has(permission)),
    'manifest requests no forbidden permissions',
  );
  check(
    !Array.isArray(manifest.host_permissions) ||
      manifest.host_permissions.length === 0,
    'manifest requests no host permissions',
  );
  check(
    !Array.isArray(manifest.optional_permissions) ||
      manifest.optional_permissions.length === 0,
    'manifest requests no optional permissions',
  );

  const worker = manifest.background?.service_worker;
  const popup = manifest.action?.default_popup;
  const sidePanel = manifest.side_panel?.default_path;
  check(typeof worker === 'string', 'manifest declares a service worker');
  check(typeof popup === 'string', 'manifest declares a popup');
  check(typeof sidePanel === 'string', 'manifest declares a side panel');

  const referenced = new Set(['manifest.json']);
  const addRef = (value) => {
    if (typeof value === 'string' && value.length > 0) {
      referenced.add(value.replace(/^\.\//, ''));
    }
  };
  addRef(worker);
  addRef(popup);
  addRef(sidePanel);
  for (const icon of Object.values(manifest.icons ?? {})) addRef(icon);
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) addRef(icon);
  for (const script of manifest.content_scripts ?? []) {
    for (const file of script.js ?? []) addRef(file);
    for (const file of script.css ?? []) addRef(file);
  }
  facts.manifestReferences = referenced.size;

  for (const file of [...referenced].sort()) {
    const path = join(dir, file);
    const present = check(existsSync(path), `manifest reference exists: ${file}`);
    if (present) {
      check(statSync(path).size > 0, `manifest reference is non-empty: ${file}`);
    }
  }

  /* --------------------------- HTML assets -------------------------- */

  const htmlFiles = [...referenced].filter((file) => file.endsWith('.html'));
  for (const htmlFile of htmlFiles) {
    const html = existsSync(join(dir, htmlFile))
      ? readFileSync(join(dir, htmlFile), 'utf8')
      : '';
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((ref) => ref && !/^(?:https?:|data:|#|chrome-extension:)/.test(ref))
      .map((ref) => ref.replace(/^\.?\//, ''));
    for (const ref of refs) {
      const present = check(existsSync(join(dir, ref)), `${htmlFile} reference exists: ${ref}`);
      if (present) {
        referenced.add(ref);
        facts.htmlReferences += 1;
      }
    }
  }

  const files = walk(dir);
  const rel = (file) => relative(dir, file).split('\\').join('/');

  /* ------------------------ script references ----------------------- */

  // Extension pages opened from JS (e.g. chrome.runtime.getURL('...html'))
  // are just as load-bearing as manifest entries, so resolve them too.
  const scriptFiles = files.filter((file) => file.endsWith('.js'));
  for (const scriptFile of scriptFiles) {
    const source = readFileSync(scriptFile, 'utf8');
    const refs = new Set();
    for (const match of source.matchAll(/["'`]([\w./-]+\.html)["'`]/g)) {
      refs.add(match[1].replace(/^\.?\//, ''));
    }
    for (const ref of refs) {
      const present = check(
        existsSync(join(dir, ref)),
        `script reference exists: ${ref} (from ${rel(scriptFile)})`,
      );
      if (present) referenced.add(ref);
    }
  }

  /* ------------------------- folder hygiene ------------------------- */

  facts.files = files.length;

  check(!files.some((file) => file.endsWith('.map')), 'no source maps are shipped');
  for (const name of DEV_FILES) {
    check(!files.some((file) => rel(file) === name), `no development file shipped: ${name}`);
  }
  check(
    !files.some((file) =>
      /(^|\/)(node_modules|tests|coverage|\.git)(\/|$)/.test(rel(file)),
    ),
    'no development folders shipped',
  );
  check(
    !files.some((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)),
    'no test files shipped',
  );

  const unreferenced = files
    .map(rel)
    .filter((file) => !referenced.has(file))
    .filter((file) => !file.startsWith('assets/'))
    .filter((file) => !file.startsWith('icons/'));
  check(
    unreferenced.length === 0,
    `no unexpected files shipped${unreferenced.length ? `: ${unreferenced.join(', ')}` : ''}`,
  );

  /* ------------------------- runtime assets ------------------------- */

  for (const icon of [
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
  ]) {
    const path = join(dir, icon);
    const bytes = existsSync(path) ? readFileSync(path) : null;
    if (check(bytes !== null, `icon present: ${icon}`) && bytes) {
      facts.icons += 1;
      check(
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
        `icon is a real PNG: ${icon}`,
      );
      check(bytes.length > 100, `icon is non-trivial: ${icon}`);
    }
  }

  for (const bundle of ['background.js', 'content.js']) {
    const path = join(dir, bundle);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
    check(source.length > 1000, `bundle is substantial: ${bundle}`);
    check(!/sourceMappingURL/.test(source), `bundle ships no map reference: ${bundle}`);
  }

  /* ----------------------------- secrets ---------------------------- */

  for (const file of files) {
    if (!/\.(?:js|css|html|json|svg|txt|md)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    const where = rel(file);
    for (const pattern of SECRET_PATTERNS) {
      check(!pattern.test(text), `no secret material in ${where}`);
    }
    check(
      !/\b(?:apiKey|api_key|secretKey|clientSecret|accessToken|refreshToken)\b\s*[:=]\s*["'][^"']{8,}["']/.test(
        text,
      ),
      `no inline credential in ${where}`,
    );
  }

  return { problems, facts };
}

/* --------------------------------- CLI -------------------------------- */

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(EXTENSION_DIR)) {
    console.error('EXTENSION FAIL: extension/ is missing — run `npm run build` first.');
    process.exit(1);
  }
  const { problems, facts } = verifyExtension();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`EXTENSION FAIL: ${problem}`);
    process.exit(1);
  }
  console.log(
    `ok - extension/manifest.json is valid MV3 (${facts.name} ${facts.version})`,
  );
  console.log(
    `ok - ${facts.manifestReferences} manifest references resolve (worker, content script, popup, side panel, icons)`,
  );
  console.log(`ok - ${facts.htmlReferences} HTML asset references resolve`);
  console.log(`ok - ${facts.icons}/4 shipped icons are real PNGs`);
  console.log('ok - no source maps, no development files, no test files shipped');
  console.log('ok - no secret material found in any shipped file');
  console.log(`ok - ${facts.files} shipped files, all expected`);
  console.log(`\nextension/ verified: ${EXTENSION_DIR}`);
}
