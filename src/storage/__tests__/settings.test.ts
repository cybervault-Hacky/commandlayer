import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStorageBackendForTests,
  getStorageBackend,
} from '../backend';
import { STORAGE_KEYS } from '../keys';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../settings';
import { Theme } from '@/shared/types/settings';

describe('settings storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetStorageBackendForTests();
  });

  it('returns defaults when nothing is stored', async () => {
    const settings = await getSettings();
    // Phase 6 added `memoryEnabled` (default on): the stored schema is
    // unchanged, so pre-Phase-6 blobs still load with memory on.
    expect(settings).toEqual({
      schema: 1,
      theme: 'dark',
      reduceMotion: false,
      onboardingSeen: false,
      memoryEnabled: true,
    });
  });

  it('defaults the Phase 6 memory switch to on for pre-Phase-6 blobs', async () => {
    await getStorageBackend().set(STORAGE_KEYS.settings, {
      schema: 1,
      theme: 'dark',
      reduceMotion: false,
      onboardingSeen: true,
    });
    const settings = await getSettings();
    expect(settings.memoryEnabled).toBe(true);
    expect(settings.onboardingSeen).toBe(true);
  });

  it('persists the Phase 6 memory switch', async () => {
    await updateSettings({ memoryEnabled: false });
    expect((await getSettings()).memoryEnabled).toBe(false);
    const raw = await getStorageBackend().get(STORAGE_KEYS.settings);
    expect(raw).toMatchObject({ memoryEnabled: false });
  });

  it('rejects a non-boolean memory switch', async () => {
    await expect(
      updateSettings({ memoryEnabled: 'off' as never }),
    ).rejects.toThrow(/settings change/i);
  });

  it('persists a settings update', async () => {
    await updateSettings({ theme: Theme.Light, reduceMotion: true });

    const settings = await getSettings();
    expect(settings.theme).toBe('light');
    expect(settings.reduceMotion).toBe(true);

    const raw = await getStorageBackend().get(STORAGE_KEYS.settings);
    expect(raw).toMatchObject({ theme: 'light', reduceMotion: true });
  });

  it('preserves untouched settings on a partial update', async () => {
    await updateSettings({ theme: Theme.Light });
    const settings = await getSettings();
    expect(settings.theme).toBe('light');
    expect(settings.reduceMotion).toBe(false);
    expect(settings.onboardingSeen).toBe(false);
  });

  it('rejects invalid patches', async () => {
    await expect(updateSettings({ theme: 'neon' as never })).rejects.toThrow(
      /settings change/i,
    );
    await expect(updateSettings({} as never)).rejects.toThrow();
    await expect(updateSettings({ reduceMotion: 'yes' as never })).rejects.toThrow();
  });

  it('recovers from a corrupted stored value', async () => {
    await getStorageBackend().set(STORAGE_KEYS.settings, '###corrupted###');
    const settings = await getSettings();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('recovers from a structurally invalid object (wrong schema)', async () => {
    await getStorageBackend().set(STORAGE_KEYS.settings, {
      schema: 2,
      theme: 'dark',
    });
    const settings = await getSettings();
    expect(settings.schema).toBe(1);
    expect(settings.theme).toBe('dark');
  });

  it('coerces wrong-typed fields to safe defaults', async () => {
    await getStorageBackend().set(STORAGE_KEYS.settings, {
      schema: 1,
      theme: 42,
      reduceMotion: 'yes',
      onboardingSeen: null,
    });
    const settings = await getSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.reduceMotion).toBe(false);
    expect(settings.onboardingSeen).toBe(false);
  });

  it('falls back to defaults when storage itself fails', async () => {
    vi.spyOn(getStorageBackend(), 'get').mockRejectedValueOnce(
      new Error('quota exceeded'),
    );
    const settings = await getSettings();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS });
  });
});
