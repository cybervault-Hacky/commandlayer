import { useCallback, useRef, useState } from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import type { PageContext, PageSection } from '@/shared/types/page';

export interface UsePageIntelligenceResult {
  /** The last engine-captured context (null until a capture succeeds). */
  insight: PageContext | null;
  capturing: boolean;
  /** On-demand capture; never runs automatically or repeatedly. */
  capture: (sections?: PageSection[]) => Promise<void>;
}

/**
 * On-demand Page Intelligence for the active tab.
 *
 * One user action → one GET_PAGE_CONTEXT → one captured context. No polling,
 * no observers, no background monitoring. Stale insight (page navigated
 * away) is cleared when the basic context URL changes.
 */
export function usePageIntelligence(basicContext: PageContext | null): UsePageIntelligenceResult {
  const [storedInsight, setInsight] = useState<PageContext | null>(null);
  const [capturing, setCapturing] = useState(false);
  const inflightRef = useRef(false);

  const capture = useCallback(async (sections?: PageSection[]) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setCapturing(true);
    try {
      const result = await sendMessage(MessageType.GET_PAGE_CONTEXT, {
        ...(sections && sections.length > 0 ? { sections } : {}),
      });
      if (result.ok) setInsight(result.data);
    } finally {
      inflightRef.current = false;
      setCapturing(false);
    }
  }, []);

  // A page navigation invalidates a previously captured insight — derived
  // at render time (no effect): if the active URL changed since capture,
  // present no insight until the next on-demand capture.
  const basicUrl =
    basicContext && basicContext.state === 'ready' ? basicContext.url : undefined;
  const insight =
    storedInsight && basicUrl && storedInsight.url && storedInsight.url !== basicUrl
      ? null
      : storedInsight;

  return { insight, capturing, capture };
}
