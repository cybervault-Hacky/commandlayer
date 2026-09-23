import { Theme, type Settings, type SettingsPatch } from '../types/settings';

export const THEMES: readonly Theme[] = [Theme.Dark, Theme.Light];

function asTheme(value: unknown): Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
    ? (value as Theme)
    : Theme.Dark;
}

/**
 * Parse a stored settings blob. Structurally invalid data (wrong schema)
 * yields null — callers fall back to defaults. Wrong-typed individual fields
 * are coerced to safe defaults so partial corruption never breaks the app.
 */
export function parseStoredSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.schema !== 1) return null;

  return {
    schema: 1,
    theme: asTheme(record.theme),
    reduceMotion:
      typeof record.reduceMotion === 'boolean' ? record.reduceMotion : false,
    onboardingSeen:
      typeof record.onboardingSeen === 'boolean' ? record.onboardingSeen : false,
    // Phase 6 field: absent in pre-Phase-6 blobs → memory defaults to on
    // (writes still require an explicit confirmation every time).
    memoryEnabled:
      typeof record.memoryEnabled === 'boolean' ? record.memoryEnabled : true,
    developerMode:
      typeof record.developerMode === 'boolean' ? record.developerMode : false,
  };
}

export type SettingsPatchValidation =
  | { ok: true; patch: SettingsPatch }
  | { ok: false; error: string };

/** Validate an untrusted settings patch before it reaches storage. */
export function validateSettingsPatch(patch: unknown): SettingsPatchValidation {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, error: 'patch must be an object' };
  }
  const record = patch as Record<string, unknown>;
  const out: SettingsPatch = {};

  if ('theme' in record) {
    if (typeof record.theme !== 'string' || !(THEMES as readonly string[]).includes(record.theme)) {
      return { ok: false, error: 'theme is invalid' };
    }
    out.theme = record.theme as Theme;
  }
  if ('reduceMotion' in record) {
    if (typeof record.reduceMotion !== 'boolean') {
      return { ok: false, error: 'reduceMotion must be a boolean' };
    }
    out.reduceMotion = record.reduceMotion;
  }
  if ('onboardingSeen' in record) {
    if (typeof record.onboardingSeen !== 'boolean') {
      return { ok: false, error: 'onboardingSeen must be a boolean' };
    }
    out.onboardingSeen = record.onboardingSeen;
  }
  if ('developerMode' in record) {
    if (typeof record.developerMode !== 'boolean') {
      return { ok: false, error: 'developerMode must be a boolean' };
    }
    out.developerMode = record.developerMode;
  }

  if ('memoryEnabled' in record) {
    if (typeof record.memoryEnabled !== 'boolean') {
      return { ok: false, error: 'memoryEnabled must be a boolean' };
    }
    out.memoryEnabled = record.memoryEnabled;
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, error: 'patch must contain at least one known setting' };
  }
  return { ok: true, patch: out };
}
