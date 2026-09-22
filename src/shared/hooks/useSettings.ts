import { useCallback, useEffect, useState } from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import { DEFAULT_SETTINGS } from '@/storage/settings';
import type { Settings, SettingsPatch } from '@/shared/types/settings';

/**
 * Settings hook: loads settings through the message layer, applies them to
 * the document (theme + motion), and persists updates. Works in the real
 * extension and in the local dev preview.
 */

export function applySettingsToDocument(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
}

export interface UseSettingsResult {
  settings: Settings;
  loading: boolean;
  /** Apply a patch; resolves true when the update was accepted. */
  update: (patch: SettingsPatch) => Promise<boolean>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await sendMessage(MessageType.GET_SETTINGS);
      if (cancelled) return;
      if (result.ok) setSettings(result.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applySettingsToDocument(settings);
  }, [settings]);

  const update = useCallback(async (patch: SettingsPatch) => {
    const result = await sendMessage(MessageType.SET_SETTINGS, { patch });
    if (result.ok) setSettings(result.data);
    return result.ok;
  }, []);

  return { settings, loading, update };
}
