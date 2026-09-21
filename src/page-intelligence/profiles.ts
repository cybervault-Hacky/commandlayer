/**
 * Capture profiles: which PageContext sections a request actually needs.
 * On-demand by design — nothing is extracted that the request does not
 * ask for.
 */
import {
  PageContextProfile,
  PageSection,
  type PageSection as Section,
} from '@/shared/types/page';
import type { QuickActionId } from '@/shared/constants/quickActions';

export const PROFILE_SECTIONS: Record<
  PageContextProfile,
  readonly Section[]
> = {
  [PageContextProfile.Full]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
    PageSection.Links,
    PageSection.Tables,
    PageSection.Forms,
    PageSection.Selection,
  ],
  [PageContextProfile.Content]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
    PageSection.Links,
    PageSection.Tables,
  ],
  [PageContextProfile.Metadata]: [PageSection.Metadata],
};

export function isPageSection(value: unknown): value is Section {
  return (
    typeof value === 'string' &&
    PROFILE_SECTIONS[PageContextProfile.Full].includes(value as Section)
  );
}

/**
 * Section sets per quick action:
 * - Analyze:   metadata + headings + text + links + tables
 * - Summarize: title + headings + main text
 * - Research:  full context capture (no external research — local only)
 * - Compare:   full context (current-page foundation)
 */
export function sectionsForQuickAction(
  actionId: QuickActionId,
): readonly Section[] | null {
  switch (actionId) {
    case 'analyze':
      return PROFILE_SECTIONS[PageContextProfile.Content];
    case 'summarize':
      return [
        PageSection.Metadata,
        PageSection.Headings,
        PageSection.Text,
      ];
    case 'research':
    case 'compare':
      return null; // full capture
  }
}
