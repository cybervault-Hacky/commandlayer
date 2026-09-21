import { useRef, type KeyboardEvent } from 'react';
import { COMMAND_TEXT_MAX } from '@/shared/constants/app';
import { cn } from '@/shared/utilities/cn';
import { IconArrowUp, IconSpinner, IconX } from './icons';

export interface CommandInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}

/**
 * The CommandLayer command input. Enter submits, Shift+Enter inserts a
 * newline; the field auto-grows up to four lines and always shows its
 * focus, disabled and loading states.
 */
export function CommandInput({
  id = 'command-input',
  value,
  onChange,
  onSubmit,
  disabled = false,
  loading = false,
  placeholder = 'Ask CommandLayer…',
}: CommandInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = disabled || loading;

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) {
      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy && value.trim().length > 0) onSubmit();
    }
  }

  return (
    <div
      className={cn(
        'rounded-[var(--cl-radius-lg)] border border-border bg-surface-elevated/80',
        'transition-[border-color,box-shadow] duration-[var(--cl-duration-fast)]',
        'focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--cl-accent-ring)]',
        busy ? 'opacity-60' : '',
      )}
    >
      <label htmlFor={id} className="sr-only">
        Command
      </label>
      <div className="flex items-end gap-2 p-3 pb-1.5">
        <textarea
          ref={textareaRef}
          id={id}
          rows={1}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="max-h-[132px] min-h-6 w-full resize-none bg-transparent text-sm leading-6 text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          {value.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                textareaRef.current?.focus();
              }}
              aria-label="Clear command"
              className="icon-btn size-7"
            >
              <IconX size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || value.trim().length === 0}
            aria-label="Submit command"
            aria-busy={loading || undefined}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full',
              'transition-colors duration-[var(--cl-duration-fast)]',
              'bg-accent text-[var(--cl-accent-contrast)]',
              'hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {loading ? <IconSpinner size={15} /> : <IconArrowUp size={15} />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <p className="text-[10.5px] leading-4 text-text-muted">
          <kbd className="kbd">Enter</kbd> to send ·{' '}
          <kbd className="kbd">Shift</kbd>+<kbd className="kbd">Enter</kbd> new
          line
        </p>
        <span
          aria-hidden="true"
          className="font-mono text-[10px] tabular-nums text-text-muted"
        >
          {value.length}/{COMMAND_TEXT_MAX}
        </span>
      </div>
    </div>
  );
}
