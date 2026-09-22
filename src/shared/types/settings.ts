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
}

/** Partial, validated settings update. */
export interface SettingsPatch {
  theme?: Theme;
  reduceMotion?: boolean;
  onboardingSeen?: boolean;
}
