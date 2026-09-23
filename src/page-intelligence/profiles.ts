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
import { AIIntent } from '@/ai/types';
import { DEVELOPER_INTENTS, type DeveloperIntent } from '@/developer/intents';

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
    PageSection.GitHub,
  ],
  [PageContextProfile.Content]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
    PageSection.Links,
    PageSection.Tables,
    PageSection.GitHub,
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
 * Section sets per reasoning intent (Phase 3):
 * - Analyze:   metadata + headings + text + links + tables
 * - Summarize / Explain / Extract: metadata + headings + text
 * - Answer:    metadata + headings + text + links + user selection
 *
 * Form data is intentionally absent from EVERY intent: forms are never
 * captured for the reasoning pipeline.
 */
export const INTENT_SECTIONS: Record<AIIntent, readonly Section[]> = {
  [AIIntent.Summarize]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
  ],
  [AIIntent.Explain]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
  ],
  [AIIntent.Extract]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
  ],
  [AIIntent.Analyze]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
    PageSection.Links,
    PageSection.Tables,
  ],
  [AIIntent.Answer]: [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
    PageSection.Links,
    PageSection.Selection,
  ],
  // Phase 7 — developer intents also need the GitHub structure of the page
  // (and nothing else: code and diffs travel through the developer context,
  // not through the generic page sections).
  ...developerSections(),
} as Record<AIIntent, readonly Section[]>;

/**
 * Phase 7 — the sections every developer intent captures: structure and text
 * from Phase 2 plus the typed GitHub context. Code bodies and diff excerpts
 * travel in the developer context block instead of being duplicated here.
 */
function developerSections(): Record<DeveloperIntent, readonly Section[]> {
  const sections: readonly Section[] = [
    PageSection.Metadata,
    PageSection.Headings,
    PageSection.Text,
    PageSection.Links,
    PageSection.GitHub,
  ];
  const out = {} as Record<DeveloperIntent, readonly Section[]>;
  for (const intent of DEVELOPER_INTENTS) {
    out[intent] = sections;
  }
  return out;
}

export function sectionsForIntent(intent: AIIntent): readonly Section[] {
  return INTENT_SECTIONS[intent];
}
