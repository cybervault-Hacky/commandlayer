// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_VERSION } from '../src/shared/constants/app';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'public', 'manifest.json');

interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  description: string;
  background?: { service_worker?: string; type?: string };
  action?: { default_popup?: string };
  side_panel?: { default_path?: string };
  commands?: Record<
    string,
    { suggested_key?: { default?: string; mac?: string } }
  >;
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
    run_at?: string;
    all_frames?: boolean;
  }>;
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

const FORBIDDEN_PERMISSIONS: string[] = [
  '<all_urls>',
  'history',
  'cookies',
  'downloads',
  'scripting',
  'webRequest',
  'webRequestAuthProvider',
  'webNavigation',
  'declarativeNetRequest',
  'unlimitedStorage',
];

describe('manifest.json (Manifest V3)', () => {
  const manifest = loadManifest();

  it('is a valid Manifest V3 document', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('has the CommandLayer identity', () => {
    expect(manifest.name).toBe(APP_NAME);
    expect(manifest.version).toBe(APP_VERSION);
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description.length).toBeGreaterThan(10);
    // Chrome/Edge cap manifest descriptions at 132 characters.
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('registers a module service worker', () => {
    expect(manifest.background).toEqual({
      service_worker: 'background.js',
      type: 'module',
    });
  });

  it('wires the popup and the side panel', () => {
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
  });

  it('defines the CommandLayer keyboard command', () => {
    const command = manifest.commands?.['open-command-layer'];
    expect(command?.suggested_key?.default).toBe('Ctrl+Shift+L');
    expect(command?.suggested_key?.mac).toBe('Command+Shift+L');
  });

  it('uses the minimal permission set (no host permissions needed)', () => {
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'tabs', 'sidePanel', 'commands']),
    );
    for (const permission of manifest.permissions ?? []) {
      expect(FORBIDDEN_PERMISSIONS, permission).not.toContain(permission);
    }
    // No host_permissions: the content script is registered via
    // content_scripts matches, and tabs.sendMessage to our own script
    // needs no host grant.
    expect(manifest.host_permissions ?? []).toHaveLength(0);
  });

  it('registers the extraction-only content script for http/https pages only', () => {
    const scripts = manifest.content_scripts;
    expect(scripts, 'content_scripts must be declared').toHaveLength(1);
    const script = scripts?.[0];
    // Broadest match that stays on the open web: browser-internal pages
    // (chrome://, edge://, about:, Web Store, PDF viewer) never match.
    expect(script?.matches).toEqual(['http://*/*', 'https://*/*']);
    expect(script?.js).toEqual(['content.js']);
    expect(script?.run_at).toBe('document_idle');
    expect(script?.all_frames).toBe(false);
  });

  it('does not use <all_urls> anywhere', () => {
    const everyMatch = (manifest.content_scripts ?? [])
      .flatMap((s) => s.matches ?? []);
    for (const match of [...(manifest.host_permissions ?? []), ...everyMatch]) {
      expect(match, match).not.toBe('<all_urls>');
    }
  });

  it('ships every declared icon asset', () => {
    for (const [size, file] of Object.entries(manifest.icons ?? {})) {
      expect(
        existsSync(join(root, 'public', file)),
        `icons/icon${size} (${file}) must exist`,
      ).toBe(true);
    }
  });
});
