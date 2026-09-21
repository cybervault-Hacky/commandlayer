import { cn } from '@/shared/utilities/cn';

export interface ToggleProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Accessible switch control (role="switch", labelled text, keyboard operable). */
export function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  const labelId = `${id}-label`;
  return (
    <div className="flex items-center justify-between gap-4">
      <span id={labelId} className="min-w-0">
        <span className="block text-[12.5px] font-medium text-text-primary">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-[var(--cl-duration-fast)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cl-accent-ring)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-accent bg-accent/90'
            : 'border-border-strong bg-surface-elevated',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-all duration-[var(--cl-duration-fast)]',
            checked ? 'left-[18px] bg-[var(--cl-accent-contrast)]' : 'left-[3px] bg-text-muted',
          )}
        />
      </button>
    </div>
  );
}
