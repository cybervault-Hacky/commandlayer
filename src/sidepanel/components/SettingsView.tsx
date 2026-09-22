import { APP_NAME, APP_VERSION, PHASE_LABEL } from '@/shared/constants/app';
import { WORKFLOW_LIMITS } from '@/workflows/limits';
import { useExtensionStatus } from '@/shared/hooks/useExtensionStatus';
import { useMemory } from '@/shared/hooks/useMemory';
import { useSettings } from '@/shared/hooks/useSettings';
import { getCommandLayerShortcut } from '@/shared/platform';
import {
  Theme,
  type Theme as ThemeType,
} from '@/shared/types/settings';
import { Segmented } from '@/shared/components/Segmented';
import { StatusDot } from '@/shared/components/StatusDot';
import { Toggle } from '@/shared/components/Toggle';
import {
  IconChevronLeft,
  IconMemory,
  IconShield,
  IconShieldCheck,
  IconSparkle,
  IconSteps,
} from '@/shared/components/icons';

const THEME_OPTIONS: readonly { value: ThemeType; label: string }[] = [
  { value: Theme.Dark, label: 'Dark' },
  { value: Theme.Light, label: 'Light' },
];

/**
 * Settings. Every control is a real, working feature: theme switching,
 * reduce motion, the Phase 6 memory privacy switch and its manager,
 * shortcut information, safety explanations, privacy, and version. No
 * placeholder settings for features that do not exist yet.
 */
export function SettingsView({
  onBack,
  onOpenMemory,
}: {
  onBack: () => void;
  onOpenMemory: () => void;
}) {
  const { settings, update } = useSettings();
  const status = useExtensionStatus();
  const memory = useMemory();
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
                server-side. AI reasoning never performs actions — it can
                understand a page, never act on it.
              </p>
            </div>
          </div>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-actions">
          <h2 id="settings-actions" className="section-label">
            Actions &amp; safety
          </h2>
          <div className="mt-3 flex items-start gap-2.5">
            <IconShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[11.5px] leading-4.5 text-text-secondary">
              Actions come from a fixed, typed allowlist — read page,
              find text, scroll, click, type, select. They never run on
              request: each plan is previewed, requires your explicit
              approval, expires quickly, and works exactly once.
            </p>
          </div>
          <ul className="mt-3 space-y-1.5 text-[11px] leading-4 text-text-muted">
            <li>• No “allow everything” mode exists or can be enabled.</li>
            <li>• Sensitive fields (passwords, payments, codes, keys) are always blocked.</li>
            <li>• Buying, deleting, sending, and downloads are not supported.</li>
            <li>• Free text like “yes” or “do it” never grants permission.</li>
            <li>• If a plan fails or the page changes, execution stops — you decide next.</li>
          </ul>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-workflows">
          <h2 id="settings-workflows" className="section-label">
            Task workflows
          </h2>
          <div className="mt-3 flex items-start gap-2.5">
            <IconSteps size={15} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[11.5px] leading-4.5 text-text-secondary">
              A workflow is a short, bounded task — up to{' '}
              {WORKFLOW_LIMITS.MAX_WORKFLOW_STEPS} steps of registered
              actions. You see every step before it runs, and each workflow
              needs its own approval.
            </p>
          </div>
          <ul className="mt-3 space-y-1.5 text-[11px] leading-4 text-text-muted">
            <li>
              • Approval is bound to the exact workflow you reviewed: any
              change to a step invalidates it and asks again.
            </li>
            <li>
              • One workflow runs per tab at a time; steps run one at a time,
              in order, never in the background of other tabs.
            </li>
            <li>
              • The page is checked only at defined checkpoints (before a
              step, after a step that changed the page, and on verification)
              — at most {WORKFLOW_LIMITS.MAX_CONTEXT_REFRESHES} checks, and
              only the minimum context needed.
            </li>
            <li>
              • A failure stops the workflow and keeps the completed steps:
              no automatic retry loops. At most{' '}
              {WORKFLOW_LIMITS.MAX_STEP_RETRIES} retry per step, and only for
              steps that are safe to repeat.
            </li>
            <li>
              • You can pause, resume, or cancel at any time. Nothing is
              remembered after the session ends.
            </li>
            <li>
              • There is no “trust forever” mode: every workflow is previewed
              and approved individually.
            </li>
          </ul>
        </section>

        <section className="cl-card p-4" aria-labelledby="settings-memory">
          <h2 id="settings-memory" className="section-label">
            Memory
          </h2>
          <div className="mt-3">
            <Toggle
              id="memory-enabled"
              label="Memory"
              description="Remember useful information you explicitly choose to save."
              checked={settings.memoryEnabled}
              onChange={(value) => {
                void update({ memoryEnabled: value });
              }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-text-primary">
              <IconMemory size={14} className="text-accent" />
              Saved memories
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[12px] tabular-nums text-text-secondary">
                {memory.total}
              </span>
              <button
                type="button"
                className="cl-btn-ghost"
                onClick={onOpenMemory}
              >
                Manage memory
              </button>
            </span>
          </div>

          {!settings.memoryEnabled && (
            <p className="mt-2.5 text-[11px] leading-4 text-warning">
              Memory is off. CommandLayer will not save or use personal
              memory. Memories saved earlier stay stored until you delete
              them.
            </p>
          )}

          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-start gap-2.5">
              <IconShield size={15} className="mt-0.5 shrink-0 text-text-muted" />
              <p className="text-[11.5px] leading-4.5 text-text-secondary">
                Memory is never collected silently. Nothing is saved without
                your confirmation, passwords and secrets are refused, page
                content never becomes memory, and the AI can never write or
                change a memory. Only the few memories relevant to a request
                are used.
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
              CommandLayer stores your preferences and any memories you
              explicitly saved locally in this browser.
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
