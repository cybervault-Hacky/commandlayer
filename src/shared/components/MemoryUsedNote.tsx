import { useState } from 'react';
import {
  MEMORY_KIND_LABELS,
  type MemoryUsedView,
} from '@/memory/types';
import { cn } from '@/shared/utilities/cn';
import { IconChevronDown, IconChevronRight, IconMemory } from './icons';

export interface MemoryUsedNoteProps {
  memories: readonly MemoryUsedView[];
  className?: string;
}

/**
 * Phase 6 — "using saved context".
 *
 * A quiet, collapsible line under an answer: which saved memories were
 * used, and nothing else. Memory never appears in the primary workflow
 * UI unless it actually shaped the answer, and the user can always see
 * exactly what was sent.
 */
export function MemoryUsedNote({ memories, className }: MemoryUsedNoteProps) {
  const [open, setOpen] = useState(false);
  if (memories.length === 0) return null;

  const label =
    memories.length === 1
      ? 'Using 1 saved memory'
      : `Using ${memories.length} saved memories`;

  return (
    <div className={cn('mt-2.5 border-t border-border/70 pt-2.5', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <IconMemory size={12} className="shrink-0 text-accent" />
        {label}
        {open ? (
          <IconChevronDown size={12} className="shrink-0 text-text-muted" />
        ) : (
          <IconChevronRight size={12} className="shrink-0 text-text-muted" />
        )}
      </button>

      {open && (
        <ul className="mt-2 space-y-1.5">
          {memories.map((memory) => (
            <li key={memory.id} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
                {MEMORY_KIND_LABELS[memory.kind]}
              </span>
              <span className="min-w-0 text-[11.5px] leading-5 break-words text-text-secondary">
                {memory.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
