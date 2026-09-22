import {
  useEffect,
  useState,
} from 'react';
import { MessageType } from '@/shared/constants/messages';
import { sendMessage } from '@/shared/messaging/client';
import type { ExtensionStatus } from '@/shared/types/status';

/** Extension status (version, environment, permissions) from the background. */
export function useExtensionStatus(): ExtensionStatus | null {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await sendMessage(MessageType.GET_EXTENSION_STATUS);
      if (!cancelled && result.ok) setStatus(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
