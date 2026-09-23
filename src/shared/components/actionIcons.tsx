import type { ReactElement } from 'react';
import type { ActionKind } from '@/actions/types';
import {
  IconClickAction,
  IconExternalLink,
  IconFindText,
  IconReadPage,
  IconScrollAction,
  IconSelectAction,
  IconTypeAction,
  type IconProps,
} from './icons';

/**
 * Icon per registered Phase 4 action kind. The mapping is closed and
 * deterministic: an action kind the registry does not define cannot be
 * rendered, and no content (page text, AI output, user input) can supply
 * an icon or a label here.
 */
export const ICON_FOR_ACTION: Record<
  ActionKind,
  (props: IconProps) => ReactElement
> = {
  READ_PAGE: IconReadPage,
  NAVIGATE_GITHUB: IconExternalLink,
  SCROLL: IconScrollAction,
  FIND_TEXT: IconFindText,
  CLICK_ELEMENT: IconClickAction,
  TYPE_TEXT: IconTypeAction,
  SELECT_OPTION: IconSelectAction,
};
