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

  it('uses the minimal Phase 1 permission set', () => {
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'tabs', 'sidePanel', 'commands']),
    );
    for (const permission of manifest.permissions ?? []) {
      expect(FORBIDDEN_PERMISSIONS, permission).not.toContain(permission);
    }
    expect(manifest.host_permissions ?? []).toHaveLength(0);
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
