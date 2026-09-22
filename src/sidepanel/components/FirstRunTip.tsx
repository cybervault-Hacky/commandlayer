import { getCommandLayerShortcut } from '@/shared/platform';
import { IconInfo, IconX } from '@/shared/components/icons';

/** One-time onboarding hint (persisted via settings.onboardingSeen). */
export function FirstRunTip({ onDismiss }: { onDismiss: () => void }) {
  const shortcut = getCommandLayerShortcut();
  return (
    <div
      role="note"
      className="cl-enter-fade mt-4 flex items-start gap-2.5 rounded-[var(--cl-radius-md)] border border-accent/25 bg-accent-soft p-3"
    >
      <IconInfo size={14} className="mt-0.5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-[11.5px] leading-[1.4] text-text-secondary">
        Tip: summon CommandLayer anywhere with{' '}
        {shortcut.keys.map((key, index) => (
          <span key={key}>
            <kbd className="kbd">{key}</kbd>
            {index < shortcut.keys.length - 1 ? ' ' : ''}
          </span>
        ))}
        {' — it opens right next to your work.'}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss tip"
        className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
      >
        <IconX size={13} />
      </button>
    </div>
  );
}
