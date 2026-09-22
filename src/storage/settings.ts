import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { Theme, type Settings, type SettingsPatch } from '@/shared/types/settings';
import { CommandLayerError } from '@/shared/security/errors';
import { parseStoredSettings, validateSettingsPatch } from '@/shared/validation/settings';
import { getStorageBackend } from './backend';
import { STORAGE_KEYS } from './keys';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schema: 1,
  theme: Theme.Dark,
  reduceMotion: false,
  onboardingSeen: false,
  memoryEnabled: true,
});

/** Read settings, recovering gracefully from missing or corrupted data. */
export async function getSettings(): Promise<Settings> {
  try {
    const backend = getStorageBackend();
    const raw = await backend.get(STORAGE_KEYS.settings);
    if (raw === undefined || raw === null) return { ...DEFAULT_SETTINGS };
    return parseStoredSettings(raw) ?? { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Apply a validated settings patch. Throws CommandLayerError(INVALID_SETTINGS)
 * for untrusted/invalid patches; persists atomically after validation.
 */
export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const validation = validateSettingsPatch(patch);
  if (!validation.ok) {
    throw new CommandLayerError(
      ErrorCode.INVALID_SETTINGS,
      USER_ERROR_MESSAGES[ErrorCode.INVALID_SETTINGS],
    );
  }
  const current = await getSettings();
  const next: Settings = { ...current, ...validation.patch };
  await getStorageBackend().set(STORAGE_KEYS.settings, next);
  return next;
}

/** Seed defaults on first install (no-op when settings already exist). */
export async function ensureDefaultSettings(): Promise<void> {
  try {
    const backend = getStorageBackend();
    const raw = await backend.get(STORAGE_KEYS.settings);
    if (raw === undefined || raw === null) {
      await backend.set(STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS });
    }
  } catch {
    // Storage failures are non-fatal; getSettings() degrades to defaults.
  }
}
