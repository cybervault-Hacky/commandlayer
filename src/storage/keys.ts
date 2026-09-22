/**
 * Namespaced storage keys. All CommandLayer data lives under the
 * `commandlayer.` namespace; nothing else is read or written.
 */
export const STORAGE_KEYS = {
  settings: 'commandlayer.settings.v1',
  /**
   * Phase 6 — persistent personal memory. Written ONLY by
   * @/memory/storage (the single mutation path); everything else reads it
   * through the memory repository.
   */
  memory: 'commandlayer.memory.v1',
} as const;

export const PREFERENCE_KEY_PREFIX = 'commandlayer.pref.';
/** Preference names: short, lowercase, dash-separated (also a safety check). */
export const PREFERENCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
