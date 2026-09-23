import { useMemo, useState } from 'react';
import {
  MEMORY_KINDS,
  MEMORY_KIND_FILTER_LABELS,
  MemoryScope,
  type MemoryKind,
  type MemoryRecordView,
} from '@/memory/types';
import { MEMORY_LIMITS } from '@/memory/limits';
import { useMemory } from '@/shared/hooks/useMemory';
import { cn } from '@/shared/utilities/cn';
import {
  IconChevronLeft,
  IconLock,
  IconMemory,
  IconSearch,
  IconTrash,
} from '@/shared/components/icons';

export interface MemoryViewProps {
  onBack: () => void;
}

type Filter = 'ALL' | MemoryKind;

/**
 * Phase 6 — the memory manager (Settings → Memory).
 *
 * Shows exactly what is stored, why it is stored, and lets the user
 * delete one memory or all of them. Deletion is always one confirmed
 * action away — there is no hidden retention.
 */
export function MemoryView({ onBack }: MemoryViewProps) {
  const memory = useMemory();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const visible = useMemo(
    () =>
      memory.records.filter(
        (record) => filter === 'ALL' || record.kind === filter,
      ),
    [memory.records, filter],
  );

  const grouped = useMemo(() => {
    return MEMORY_KINDS.map((kind) => ({
      kind,
      records: visible.filter((record) => record.kind === kind),
    })).filter((group) => group.records.length > 0);
  }, [visible]);

  const handleSearch = (value: string) => {
    setQuery(value);
    void memory.refresh(value, filter === 'ALL' ? null : filter);
  };

  const handleFilter = (next: Filter) => {
    setFilter(next);
    void memory.refresh(query, next === 'ALL' ? null : next);
  };

  return (
    <div className="cl-enter-fade flex min-h-full flex-col">
      <header className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to settings"
          className="icon-btn"
        >
          <IconChevronLeft size={16} />
        </button>
        <h1 className="text-[15px] font-semibold text-text-primary">Memory</h1>
      </header>

      <p className="mt-3 text-[11.5px] leading-4.5 text-text-muted">
        CommandLayer remembers only information you explicitly choose to
        save. Memories are stored in this browser, are readable at any time
        here, and can be deleted individually. Nothing is learned from
        browsing, page content, or answers.
      </p>

      {!memory.enabled && (
        <div
          role="status"
          className="cl-card mt-3 border-warning/30 p-3.5"
          data-testid="memory-off-notice"
        >
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-text-primary">
            <IconLock size={14} className="text-warning" />
            Memory is off.
          </p>
          <p className="mt-1 text-[11.5px] leading-4.5 text-text-secondary">
            CommandLayer will not save or use personal memory. Memories you
            saved earlier are still stored — delete them below, or turn
            memory back on in Settings.
          </p>
        </div>
      )}

      {!memory.storageAvailable && (
        <p role="status" className="mt-3 text-[11.5px] leading-4 text-warning">
          Saved memories could not be read right now. Nothing was lost — try
          again in a moment.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2.5">
        <div className="relative">
          <IconSearch
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => handleSearch(event.target.value)}
            placeholder="Search saved memories"
            aria-label="Search saved memories"
            className="cl-input"
          />
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          <button
            type="button"
            aria-pressed={filter === 'ALL'}
            onClick={() => handleFilter('ALL')}
            className="cl-chip"
          >
            All
          </button>
          {MEMORY_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={filter === kind}
              onClick={() => handleFilter(kind)}
              className="cl-chip"
            >
              {MEMORY_KIND_FILTER_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>

      {memory.notice && (
        <p role="status" className="mt-3 text-[11.5px] leading-4 text-text-secondary">
          {memory.notice}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {memory.loading && memory.records.length === 0 && (
          <p className="text-[11.5px] text-text-muted">Loading…</p>
        )}

        {!memory.loading && visible.length === 0 && (
          <div className="cl-card flex flex-col items-center gap-2 px-4 py-8 text-center">
            <IconMemory size={20} className="text-text-muted" />
            <p className="max-w-[260px] text-[11.5px] leading-5 text-text-muted">
              {memory.total === 0
                ? 'No saved memories yet. Ask CommandLayer to remember something — for example “Remember that I prefer TypeScript.”'
                : 'No saved memories match this view.'}
            </p>
          </div>
        )}

        {grouped.map((group) => (
          <section key={group.kind} aria-label={MEMORY_KIND_FILTER_LABELS[group.kind]}>
            <h2 className="section-label">
              {MEMORY_KIND_FILTER_LABELS[group.kind]}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {group.records.map((record) => (
                <MemoryRow
                  key={record.id}
                  record={record}
                  confirming={pendingDelete === record.id}
                  onAskDelete={() => setPendingDelete(record.id)}
                  onCancelDelete={() => setPendingDelete(null)}
                  onDelete={() => {
                    setPendingDelete(null);
                    void memory.remove(record.id);
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-6 border-t border-border pt-4">
        {confirmClear ? (
          <div className="cl-card border-error/30 p-3.5" role="alertdialog" aria-label="Delete all saved memories?">
            <p className="text-[12.5px] font-medium text-text-primary">
              Delete all saved memories?
            </p>
            <p className="mt-1 text-[11.5px] leading-4.5 text-text-secondary">
              This removes every stored memory and cannot be undone.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="cl-btn-danger"
                onClick={() => {
                  setConfirmClear(false);
                  void memory.clearAll();
                }}
              >
                Delete all
              </button>
              <button
                type="button"
                className="cl-btn-ghost"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-4 text-text-muted">
              {memory.total} of {MEMORY_LIMITS.MAX_MEMORY_RECORDS} memories
              stored
            </p>
            <button
              type="button"
              className="cl-btn-ghost"
              onClick={() => setConfirmClear(true)}
              disabled={memory.total === 0}
            >
              <IconTrash size={13} />
              Clear all memory
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

interface MemoryRowProps {
  record: MemoryRecordView;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function MemoryRow({
  record,
  confirming,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: MemoryRowProps) {
  return (
    <li className="cl-card p-3">
      <p className="text-[12.5px] leading-5 break-words text-text-primary">
        {record.content}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-muted">
        <span>{record.audit}</span>
        {record.scope === MemoryScope.Project && record.project && (
          <span className={cn('rounded-full border border-border px-1.5 py-0.5')}>
            project · {record.project}
          </span>
        )}
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        {confirming ? (
          <>
            <button type="button" className="cl-btn-danger" onClick={onDelete}>
              Delete
            </button>
            <button
              type="button"
              className="cl-btn-ghost"
              onClick={onCancelDelete}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cl-btn-ghost"
            onClick={onAskDelete}
            aria-label={`Delete memory: ${record.content}`}
          >
            <IconTrash size={13} />
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
