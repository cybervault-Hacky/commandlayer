import {
  ErrorCode,
  USER_ERROR_MESSAGES,
} from '@/shared/constants/errors';
import { getQuickAction } from '@/shared/constants/quickActions';
import { CommandLayerError } from '@/shared/security/errors';
import { createRequestId } from '@/shared/messaging/envelope';
import type {
  CommandRequest,
  CommandSource,
  QuickActionId,
} from '@/shared/types/command';
import type { PageContext } from '@/shared/types/page';

/** Build a structured CommandRequest from raw UI input. */
export function buildCommandRequest(input: {
  text: string;
  source: CommandSource;
  quickAction?: QuickActionId;
  context: PageContext | null;
  tabId?: number;
}): CommandRequest {
  return {
    id: createRequestId('cmd'),
    text: input.text,
    source: input.source,
    ...(input.quickAction ? { quickAction: input.quickAction } : {}),
    context: input.context,
    ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
    createdAt: new Date().toISOString(),
  };
}

/** Build a CommandRequest for a quick action using its template. */
export function buildQuickActionRequest(
  actionId: QuickActionId,
  source: CommandSource,
  context: PageContext | null,
): CommandRequest {
  const action = getQuickAction(actionId);
  if (!action) {
    throw new CommandLayerError(
      ErrorCode.INVALID_PAYLOAD,
      USER_ERROR_MESSAGES[ErrorCode.INVALID_PAYLOAD],
    );
  }
  return buildCommandRequest({
    text: action.template,
    source,
    quickAction: action.id,
    context,
  });
}
