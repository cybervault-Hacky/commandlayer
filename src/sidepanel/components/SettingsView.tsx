import { APP_NAME, APP_VERSION, PHASE_LABEL } from '@/shared/constants/app';
import { useExtensionStatus } from '@/shared/hooks/useExtensionStatus';
import { useSettings } from '@/shared/hooks/useSettings';
import { getCommandLayerShortcut } from '@/shared/platform';
import {
  Theme,
  type Theme as ThemeType,
} from '@/shared/types/settings';
import { Segmented } from '@/shared/components/Segmented';
import { StatusDot } from '@/shared/components/StatusDot';
import { Toggle } from '@/shared/components/Toggle';
import { IconChevronLeft, IconShield, IconSparkle } from '@/shared/components/icons';

const THEME_OPTIONS: readonly { value: ThemeType; label: string }[] = [
  { value: Theme.Dark, label: 'Dark' },
  { value: Theme.Light, label: 'Light' },
];

/**
 * Phase 1 settings. Every control is a real, working feature:
 * theme switching, reduce motion, shortcut information, privacy and version.
 * No placeholder settings for features that do not exist yet.
 */
export function SettingsView({ onBack }: { onBack: () => void }) {
  const { settings, update } = useSettings();
  const status = useExtensionStatus();
  const shortcut = getCommandLayerShortcut();

  return (
    <div className="cl-enter-fade flex min-h-full flex-col">
      <header className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to main view"
          className="icon-btn"
        >
          <IconChevronLeft size={16} />
        </button>
        <h1 className="text-[15px] font-semibold text-text-primary">Settings</h1>
      </header>

      <div className="mt-5 flex flex-col gap-3">
        <section className="cl-card p-4" aria-labelledby="settings-appearance">
          <h2 id="settings-appearance" className="section-label">
            Appearance
          </h2>
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="text-[12.5px] font-medium text-text-primary">
              Theme
            </span>
            <Segmented
              ariaLabel="Theme"
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(value) => {
                void update({ theme: value });
              }}
            />
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <Toggle
              id="reduce-motion"
              label="Reduce motion"
              description="Minimize animations and transitions."
              checked={settings.reduceMotion}
              onChange={(value) => {
                void update({ reduceMotion: value });
              }}
            />
          </div>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-intelligence">
          <h2 id="settings-intelligence" className="section-label">
            Intelligence
          </h2>
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-text-primary">
              <IconSparkle size={14} className="text-accent" />
              Reasoning provider
            </span>
            <span className="flex items-center gap-1.5 text-xs text-text-secondary">
              <StatusDot tone={status?.ai.mode === 'gateway' ? 'accent' : 'success'} />
              {status?.ai.providerLabel ?? 'Local mock provider'}
            </span>
          </div>
          <p className="mt-2.5 text-[11px] leading-4 text-text-muted">
            {status?.ai.mode === 'gateway'
              ? 'Reasoning is routed through your configured Secure Gateway.'
              : 'Running on the built-in local mock provider — fully functional, no setup, no secrets.'}
          </p>
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start gap-2.5">
              <IconShield size={15} className="mt-0.5 shrink-0 text-text-muted" />
              <p className="text-[11.5px] leading-4.5 text-text-secondary">
                CommandLayer never stores provider API keys or secrets. A
                gateway connection needs only its URL; credentials stay
                server-side. Reasoning is read-only — it can understand a
                page, never act on it.
              </p>
            </div>
          </div>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-shortcut">
          <h2 id="settings-shortcut" className="section-label">
            Keyboard shortcut
          </h2>
          <div className="mt-3 flex items-center gap-1.5">
            {shortcut.keys.map((key) => (
              <kbd key={key} className="kbd">
                {key}
              </kbd>
            ))}
            <span className="ml-1.5 text-xs text-text-secondary">
              Open CommandLayer
            </span>
          </div>
          <p className="mt-2.5 text-[11px] leading-4 text-text-muted">
            Customize it in your browser’s Extensions → Keyboard shortcuts.
          </p>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-privacy">
          <h2 id="settings-privacy" className="section-label">
            Privacy
          </h2>
          <div className="mt-3 flex items-start gap-2.5">
            <IconShield size={15} className="mt-0.5 shrink-0 text-text-muted" />
            <p className="text-[11.5px] leading-4.5 text-text-secondary">
              CommandLayer stores your preferences locally in this browser.
              Reasoning requests include only the minimized page context
              needed for your intent — form fields and their values are
              never sent. Transcripts are session-only and never stored.
            </p>
          </div>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-about">
          <h2 id="settings-about" className="section-label">
            About
          </h2>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">{APP_NAME}</dt>
              <dd className="font-mono text-text-secondary">
                v{status?.version ?? APP_VERSION}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Build</dt>
              <dd className="text-text-secondary">{PHASE_LABEL}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
