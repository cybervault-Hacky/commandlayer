import { useCallback, useEffect, useState } from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import type { MemoryKind, MemoryRecordView } from '@/memory/types';
import type { MemoryListView } from '@/shared/types/message';

/**
 * Phase 6 — the UI-side memory client.
 *
 * Surfaces never touch memory storage: they read bounded listings and
 * send explicit, user-confirmed mutations through the message layer. The
 * background remains the only writer.
 */
export interface UseMemoryResult {
  /** Privacy switch (Settings → Memory). */
  enabled: boolean;
  /** False when storage could not be read (graceful degradation). */
  storageAvailable: boolean;
  records: MemoryRecordView[];
  total: number;
  loading: boolean;
  /** Last user-safe operation message (deleted, cleared, failure). */
  notice: string | null;
  refresh: (query?: string, kind?: MemoryKind | null) => Promise<void>;
  remove: (memoryId: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
  clearNotice: () => void;
}

export function useMemory(): UseMemoryResult {
  const [records, setRecords] = useState<MemoryRecordView[]>([]);
  const [total, setTotal] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  /** Read one bounded listing from the background (never storage directly). */
  const load = useCallback(
    (query = '', kind: MemoryKind | null = null) =>
      sendMessage(MessageType.MEMORY_LIST, {
        ...(query ? { query } : {}),
        ...(kind ? { kind } : {}),
      }),
    [],
  );

  /** Apply one listing result to the local view. */
  const applyListing = useCallback(
    (result: Awaited<ReturnType<typeof load>>) => {
      if (result.ok) {
        const data: MemoryListView = result.data;
        setRecords(data.records);
        setTotal(data.total);
        setEnabled(data.enabled);
        setStorageAvailable(data.storageAvailable);
      } else {
        setRecords([]);
        setNotice(result.error.message);
      }
    },
    [],
  );

  const refresh = useCallback(
    async (query = '', kind: MemoryKind | null = null) => {
      setLoading(true);
      applyListing(await load(query, kind));
      setLoading(false);
    },
    [applyListing, load],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await load();
      if (cancelled) return;
      applyListing(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyListing, load]);

  const remove = useCallback(async (memoryId: string) => {
    const result = await sendMessage(MessageType.MEMORY_DELETE, {
      memoryId,
      confirm: true,
    });
    if (result.ok) {
      setNotice(result.data.message);
      setRecords((current) => current.filter((record) => record.id !== memoryId));
      setTotal((current) => Math.max(0, current - 1));
      return true;
    }
    setNotice(result.error.message);
    return false;
  }, []);

  const clearAll = useCallback(async () => {
    const result = await sendMessage(MessageType.MEMORY_CLEAR_ALL, {
      confirm: true,
    });
    if (result.ok) {
      setNotice(result.data.message);
      setRecords([]);
      setTotal(0);
      return true;
    }
    setNotice(result.error.message);
    return false;
  }, []);

  return {
    enabled,
    storageAvailable,
    records,
    total,
    loading,
    notice,
    refresh,
    remove,
    clearAll,
    clearNotice: useCallback(() => setNotice(null), []),
  };
}
