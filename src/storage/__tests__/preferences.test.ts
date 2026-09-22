import { beforeEach, describe, expect, it } from 'vitest';
import { __resetStorageBackendForTests } from '../backend';
import { getPreference, setPreference } from '../preferences';

describe('preferences', () => {
  beforeEach(() => {
    __resetStorageBackendForTests();
  });

  it('round-trips a value', async () => {
    await setPreference('last-view', 'settings');
    await expect(getPreference('last-view')).resolves.toBe('settings');
  });

  it('namespaces keys under the CommandLayer prefix', async () => {
    await setPreference('last-view', 'settings');
    const { getStorageBackend } = await import('../backend');
    const raw = await getStorageBackend().get('commandlayer.pref.last-view');
    expect(raw).toBe('settings');
  });

  it('returns undefined for unknown keys', async () => {
    await expect(getPreference('never-set')).resolves.toBeUndefined();
  });

  it('rejects malformed names', async () => {
    await expect(setPreference('Bad/Name', 1)).rejects.toThrow();
    await expect(setPreference(''.padEnd(1), 1)).rejects.toThrow();
    await expect(setPreference('x'.repeat(60), 1)).rejects.toThrow();
    await expect(getPreference('../escape')).rejects.toThrow();
  });

  it('rejects non-serializable values', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(setPreference('weird', circular)).rejects.toThrow();
  });
});
