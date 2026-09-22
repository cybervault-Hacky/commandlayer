/** Theme values supported in Phase 1 (dark is the default). */
export const Theme = {
  Dark: 'dark',
  Light: 'light',
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];

export interface Settings {
  /** Bump when the stored shape changes; old data is discarded gracefully. */
  schema: 1;
  theme: Theme;
  reduceMotion: boolean;
  onboardingSeen: boolean;
  /**
   * Phase 6 — the memory privacy switch. When off, CommandLayer neither
   * saves nor uses personal memory (existing memories stay stored until
   * the user deletes them, so they remain inspectable and deletable).
   */
  memoryEnabled: boolean;
}

/** Partial, validated settings update. */
export interface SettingsPatch {
  theme?: Theme;
  reduceMotion?: boolean;
  onboardingSeen?: boolean;
  memoryEnabled?: boolean;
}
