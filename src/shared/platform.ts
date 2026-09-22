/**
 * Platform helpers for displaying the keyboard shortcut. The manifest
 * registers Ctrl+Shift+L (default) and Command+Shift+L (mac) — this mirrors
 * that for the UI labels.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  const userAgent = navigator.userAgent ?? '';
  return /mac/i.test(platform) || /mac os/i.test(userAgent);
}

export interface ShortcutDisplay {
  keys: string[];
  label: string;
}

export function getCommandLayerShortcut(): ShortcutDisplay {
  return isMacPlatform()
    ? { keys: ['⌘', '⇧', 'L'], label: 'Command + Shift + L' }
    : { keys: ['Ctrl', 'Shift', 'L'], label: 'Ctrl + Shift + L' };
}
