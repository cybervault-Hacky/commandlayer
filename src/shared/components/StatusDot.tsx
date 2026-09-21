import { cn } from '@/shared/utilities/cn';

export type StatusTone = 'success' | 'warning' | 'error' | 'neutral' | 'accent';

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  neutral: 'bg-text-muted',
  accent: 'bg-accent',
};

/** Small status indicator (decorative; pair with visible text labels). */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  className,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        TONE_CLASS[tone],
        pulse ? 'cl-pulse' : '',
        className,
      )}
    />
  );
}
