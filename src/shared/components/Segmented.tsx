import { cn } from '@/shared/utilities/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  ariaLabel: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Compact segmented control (button group with pressed state). */
export function Segmented<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-[10px] border border-border bg-surface p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg px-3 py-1 text-[12px] font-medium transition-colors duration-[var(--cl-duration-fast)]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cl-accent-ring)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'bg-surface-elevated text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
