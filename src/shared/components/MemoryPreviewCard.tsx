import {
  useEffect,
  useRef,
  type KeyboardEvent,
} from 'react';
import {
  MemoryPreviewAction,
  MEMORY_KIND_LABELS,
  type MemoryPreviewView,
} from '@/memory/types';
import { cn } from '@/shared/utilities/cn';
import { IconAlertTriangle, IconMemory, IconShield } from './icons';

export interface MemoryPreviewCardProps {
  preview: MemoryPreviewView;
  onConfirm: () => void;
  onCancel: () => void;
  /** Read-only rendering (e.g. inside the session transcript). */
  readOnly?: boolean;
  /** Inline, user-safe notice (e.g. an expired preview). */
  notice?: string | null;
}

function titleFor(action: MemoryPreviewView['action']): string {
  switch (action) {
    case MemoryPreviewAction.Update:
      return 'Update memory';
    case MemoryPreviewAction.Delete:
      return 'Forget this memory?';
    default:
      return 'Remember this?';
  }
}

function confirmLabel(action: MemoryPreviewView['action']): string {
  switch (action) {
    case MemoryPreviewAction.Update:
      return 'Update';
    case MemoryPreviewAction.Delete:
      return 'Forget';
    default:
      return 'Remember';
  }
}

/**
 * Phase 6 — the consent surface for memory.
 *
 * Nothing is stored until the user presses the primary button here: the
 * card shows exactly what would be saved, its category, who it came from,
 * and whether it replaces something already saved. Confirming sends only
 * the preview id — the body stays in the background.
 */
export function MemoryPreviewCard({
  preview,
  onConfirm,
  onCancel,
  readOnly = false,
  notice = null,
}: MemoryPreviewCardProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!readOnly) confirmRef.current?.focus();
  }, [readOnly, preview.previewId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  const isDelete = preview.action === MemoryPreviewAction.Delete;
  const isUpdate = preview.action === MemoryPreviewAction.Update;

  return (
    <div
      className={cn(
        'cl-card cl-enter mt-3 overflow-hidden',
        isDelete ? 'border-error/30' : 'border-accent/25',
      )}
      aria-label={titleFor(preview.action)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          {isDelete ? (
            <IconAlertTriangle size={12} className="shrink-0 text-error" />
          ) : (
            <IconMemory size={12} className="shrink-0 text-accent" />
          )}
          {isDelete ? 'Delete memory' : isUpdate ? 'Update memory' : 'New memory'}
        </span>
        {preview.kind && (
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-text-secondary">
            {MEMORY_KIND_LABELS[preview.kind]}
          </span>
        )}
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[12.5px] font-medium text-text-primary">
          {titleFor(preview.action)}
        </p>

        {isUpdate && preview.previousContent && (
          <div className="mt-2.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Before
            </p>
            <p className="mt-1 text-[12px] leading-5 text-text-muted line-through decoration-border">
              {preview.previousContent}
            </p>
          </div>
        )}

        <div className="mt-2.5">
          {isUpdate && (
            <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
              After
            </p>
          )}
          <p
            className={cn(
              'text-[12.5px] leading-5 break-words text-text-primary',
              !isUpdate && 'mt-1',
            )}
          >
            “{preview.content}”
          </p>
        </div>

        {(preview.scope === 'PROJECT' && preview.project) && (
          <p className="mt-2 text-[11px] text-text-muted">
            Scope · project “{preview.project}” — never applied to other
            projects.
          </p>
        )}

        <div className="mt-3 flex items-start gap-2 border-t border-border/70 pt-2.5">
          <IconShield size={13} className="mt-0.5 shrink-0 text-text-muted" />
          <p className="text-[11px] leading-4 text-text-muted">
            {isDelete
              ? 'This deletes the saved memory. It cannot be undone.'
              : `Source · ${preview.source === 'USER_EXPLICIT' ? 'You explicitly asked CommandLayer to remember this.' : 'Unknown.'}`}
            {isUpdate && ' It replaces the saved value above.'}
          </p>
        </div>

        {notice && (
          <p
            role="status"
            className="mt-2 text-[11px] leading-4 text-warning"
          >
            {notice}
          </p>
        )}

        {!readOnly && (
          <div className="mt-3 flex items-center gap-2">
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              onKeyDown={(event) => {
                if (event.key === 'Tab' && !event.shiftKey) {
                  event.preventDefault();
                  cancelRef.current?.focus();
                } else {
                  handleKeyDown(event);
                }
              }}
              className={isDelete ? 'cl-btn-danger' : 'btn-primary'}
            >
              {confirmLabel(preview.action)}
            </button>
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              onKeyDown={(event) => {
                if (event.key === 'Tab' && event.shiftKey) {
                  event.preventDefault();
                  confirmRef.current?.focus();
                } else {
                  handleKeyDown(event);
                }
              }}
              className="cl-btn-ghost"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
