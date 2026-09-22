import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import type { PageContext } from '@/shared/types/page';

export interface UsePageContextResult {
  context: PageContext | null;
  loading: boolean;
  /** Debounced refresh (safe to call from focus/visibility events). */
  refresh: () => void;
}

/**
 * Current-page context for the active tab, kept fresh while the surface is
 * visible. In dev preview this resolves to 'unavailable' — a real state,
 * not an error.
 */
export function usePageContext(): UsePageContextResult {
  const [context, setContext] = useState<PageContext | null>(null);
  const [loading, setLoading] = useState(true);
  const inflightRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const result = await sendMessage(MessageType.GET_CURRENT_PAGE);
      if (result.ok) setContext(result.data);
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void load();
    }, 250);
  }, [load]);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return { context, loading, refresh };
}
