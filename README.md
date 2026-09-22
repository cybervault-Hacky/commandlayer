# CommandLayer

**Think once. Execute everywhere.**

CommandLayer is a premium, local-first command layer for the browser: a
Manifest V3 extension for **Microsoft Edge** that understands the page you are
on, reasons about it on demand, and — only with your explicit approval —
carries out short, bounded tasks in the page.

Nothing runs in the background. Nothing is remembered after the session. The
extension never collects form values, passwords, cookies, browser storage,
authentication tokens, or browsing history, and no AI model ever receives more
than the minimal page context a single request needs.

Built for **Microsoft Edge** (Manifest V3), and compatible with Chromium
WebExtension APIs where practical.

| | |
| --- | --- |
| **Version** | `0.4.0` — Phase 5 complete (Contextual Workflow Engine) |
| **Platform** | Microsoft Edge / Chromium, Manifest V3, `minimum_chrome_version: 116` |
| **Publishable build** | [`extension/`](extension) — self-contained, no build step needed |
| **Permissions** | `commands`, `sidePanel`, `storage`, `tabs` — no host permissions |
| **Privacy** | Local-first, on-demand, session-only, zero telemetry |

---

## Install in Microsoft Edge (no build step required)

The repository already contains the production build. `extension/` is the
complete, self-contained extension — it is the only folder needed to install
or publish CommandLayer.

1. Download or copy this repository.
2. Open `edge://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`extension/`** folder.
5. Click the CommandLayer toolbar icon for the **Popup**.
6. Click **Open Side Panel** — or press **Ctrl+Shift+L** — for the **Side
   Panel**, the primary experience.
7. Click **Open Command Center** for the full-window command experience.

No `npm`, no build tools, and no network access are required to load the
extension. (`npm` is only needed if you want to modify CommandLayer — see
[Development](#development).)

### Keyboard shortcut

- Windows / Linux: `Ctrl + Shift + L`
- macOS: `⌘ + Shift + L`

The shortcut opens the Side Panel for the active tab, and falls back to the
Command Center tab if the side panel cannot be opened. Change or view it in
`edge://extensions` → **Keyboard shortcuts**. Edge only allows the side panel
to open in response to a user gesture (shortcut, popup click, toolbar
interaction), which is why the fallback exists.

### Site access

The content script (extraction-only) is declared for `http://*/*` and
`https://*/*` via `content_scripts` — there are **no host permissions**. If a
capture reports *Site access required*, allow the site in `edge://extensions`
→ CommandLayer → **Site access**. Nothing already captured is stored or sent
anywhere.

---

## What CommandLayer can do today

### Command surfaces

- **Side Panel** — the primary experience: command input, quick actions, live
  current-page context, page insight, reasoning results, workflow previews
  and progress, inline settings.
- **Popup** — a compact launcher: extension status, current-page status,
  *Open Side Panel* / *Open Command Center*, shortcut info.
- **Command Center** — a full-window experience with a session-only reasoning
  transcript and command log.
- **Keyboard shortcut** — `Ctrl+Shift+L` (`⌘⇧L`).

### Page intelligence

On demand (never automatically), the content script extracts a bounded,
structural picture of the current page: metadata, heading hierarchy, readable
text, links, tables, forms (structure only), and the current selection. Every
section has hard caps and honest `ready` / `partial` / `unsupported` states.
Forms are captured as `{ name, type, label, required }` — **values are never
read**, not even for passwords.

### AI reasoning

Commands and quick actions (Analyze / Summarize / Explain / Extract) run
through a validated pipeline:
intent resolution → minimal per-intent context → injection-defended prompt →
parsed-and-validated response → injected-safe rendering. The default provider
is a **built-in local mock engine** (zero configuration, deterministic, fully
functional). Real-model reasoning is supported through an optional
**Secure Intelligence Gateway** (`Extension → HTTPS → Gateway → Provider`) so
provider secrets never live in the extension.

### Safe Action Engine

Six typed, bounded actions: read page, find text, scroll, click, type, select.
Every action follows one pipeline — **Preview → Permission → Execute →
Verify**:

- actions are proposed by a deterministic planner, never invented by the model;
- you see an explicit preview and approve the *exact* plan;
- approvals are single-use, expire within minutes, and are bound to the plan
  hash and page context;
- sensitive fields (passwords, payments, codes, keys) are always blocked;
- elements are targeted by visible text/label, not by injected selectors;
- execution stops on failure, and results are verified against observation.

The Action Engine is the **single execution security boundary** in
CommandLayer.

### Contextual workflows

Short, bounded, multi-step tasks — *"find \"pricing\" and open the result"*,
*"scroll down and read the page"* — are understood locally and
deterministically, planned into at most **4 steps** of one action each,
previewed step by step, and executed **one step at a time, only after an
approval bound to the exact workflow hash**. Each step runs through the Action
Engine and is verified before the workflow continues. A failure stops the run
and keeps what already completed. You can **pause, resume, or cancel** at any
time, page changes stop the workflow (`WORKFLOW_CONTEXT_CHANGED`), and nothing
is remembered after the session.

### Deliberately not included

No autonomous browsing, no always-on background agent, no scheduled or
recurring automation, no unbounded observe→reason→act loop, no persistent
memory, no payments, no bulk or always-allow approvals, and no integrations.
Multi-page research and cross-tab comparison are not implemented — the Phase 1
*Research* / *Compare* quick actions were removed from the UI rather than
faked.

---

## Security & privacy model

- **Minimal permissions.** `commands`, `sidePanel`, `storage`, `tabs`. No host
  permissions, no `<all_urls>`, no cookies, history, downloads, debugger,
  native messaging, management, or scripting access.
- **`tabs` is used only** to read the *active* tab's title and URL.
- **Strictly on demand.** Page content is read only when you ask — capture
  click, command, quick action, or an approved action step. No observers, no
  polling, no monitoring, no background work.
- **Sensitive data is never collected.** The extractor never reads `.value`;
  the validator rejects any `value` key (and unknown keys) in content-script
  responses; regression tests assert the absence of secrets end-to-end.
  Passwords appear only as `type: "password"`.
- **AI input is untrusted, AI output is untrusted.** Webpage content enters
  prompts as delimited, labeled, escape-neutralized data. Responses are parsed
  as JSON only, validated against a closed trust policy (request-id echo,
  closed field set, http/https-only sources, budget caps), and rendered as
  React text nodes — untrusted output can never execute code.
- **AI can never act.** Model output cannot create permissions, cannot
  downgrade risk, cannot skip confirmation, cannot bypass sensitive-field
  blocks, and cannot execute code. Only the Action Engine executes, and only
  after your explicit approval of a validated plan.
- **No secrets, no eval, no remote code.** No API keys, no `eval`/`Function`,
  no remote scripts or CDNs. Provider credentials live only in the optional
  gateway, never in the extension.
- **No persistence of work.** Conversations, reasoning results, action plans,
  and workflows are session-only. `chrome.storage.local` holds validated
  preferences only.
- **Safe errors and honest states.** The UI renders user-safe messages from a
  fixed vocabulary — never stack traces — and reports real states
  (`ready` / `partial` / `unsupported` / `unavailable` / *site access
  required*) instead of pretending.

### Permissions reference

| Permission | Why it is needed |
| --- | --- |
| `commands` | Registers the `Ctrl+Shift+L` / `⌘⇧L` keyboard shortcut |
| `sidePanel` | Opens and hosts the Side Panel experience |
| `storage` | Stores validated preferences (theme, motion, gateway URL, safety toggles) |
| `tabs` | Reads the *active* tab's title and URL only |

`content_scripts` matches `http://*/*` and `https://*/*`, `run_at:
document_idle`, `all_frames: false` — the extraction-only content script. No
host permissions are requested.

---

## Repository layout

```
commandlayer/
├── extension/          ← the publishable extension (load this in Edge)
│   ├── manifest.json       Manifest V3
│   ├── background.js       service worker (ES module)
│   ├── content.js          extraction-only content script
│   ├── popup.html
│   ├── sidepanel.html
│   ├── command-center.html
│   ├── assets/             bundled JS + CSS
│   └── icons/              16 / 32 / 48 / 128 PNG app icons
├── README.md           ← this file (stays at the repository root)
├── src/                maintainable TypeScript source for the extension
├── tests/              manifest / config validation tests
├── scripts/            build, icon generation, smoke and structure verifiers
├── docs/               engine documentation
├── public/             manifest + icon sources copied into the build
└── vite / vitest / eslint / tsconfig / package.json
```

`extension/` is **build output**: it is produced by the production build from
`src/` and `public/`, is committed so the repository is directly loadable, and
is never hand-edited. `README.md` always lives at the root, never inside
`extension/`.

---

## Development

Requirements: **Node.js ≥ 20.19** (build tooling only — never required to
load the extension).

```bash
npm install
npm run dev        # Vite dev server: http://localhost:5173/sidepanel.html,
                   # /popup.html, /command-center.html
```

The dev server previews the three UI surfaces in a regular browser. Without
browser extension APIs it runs in preview mode: the full local pipeline works,
page context shows as unavailable, and settings persist in memory only.

| Script | Purpose |
| --- | --- |
| `npm run build` | Production build → `extension/` (worker + content script + 3 UI surfaces) |
| `npm run verify:extension` | Structurally verify `extension/` (MV3 manifest, references, hygiene, secrets) |
| `npm run smoke` | Build, verify, then smoke-test the built worker + content script in Node |
| `npm run check` | lint + typecheck + test + build + verify |
| `npm run lint` | ESLint over the repository |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `npm test` | Vitest unit / integration / UI suites |
| `npm run test:watch` | Vitest in watch mode |
| `npm run icons` | Regenerate the PNG app icons (dependency-free generator) |
| `npm run clean` | Remove the build output |

After `npm run build`, reload the extension in `edge://extensions`
(CommandLayer → reload) to pick up the new bundle.

### Verifying a publishable build

```bash
npm run smoke
```

`verify:extension` asserts that `extension/` is a valid MV3 package: Manifest
V3 shape and identity, minimal permissions (no host/optional permissions), the
declared service worker / popup / side panel / content script / icons exist and
are non-empty, every HTML and script asset reference resolves, icons are real
PNGs, bundles are substantial and map-free, no development files or tests are
shipped, only expected files are present, and no secret material appears in any
shipped file. `smoke-worker` then boots the built `background.js` **and**
`content.js` (into a jsdom page fixture containing prompt-injection content)
with a Chrome shim and exercises real round-trips — extraction, reasoning
commands, quick actions, the form-value guarantees, and the full Phase 5
workflow path plus wrong-hash, cancelled, stale-tab, sensitive-field,
duplicate-approval, and no-storage-write checks.

---

## Testing

```bash
npm test
```

The suite runs **63 test files / 583 tests** and covers, among other things:

- **Manifest & config validation** — MV3 shape, identity, worker, popup, side
  panel, keyboard command, content-script registration (http/https only, no
  `<all_urls>`), minimal permissions, icon assets.
- **Storage & messaging** — defaults, partial updates, corrupted values,
  failing backends, malformed envelopes, unknown message types, sender trust,
  payload validation.
- **Page intelligence** — metadata, headings, readable text, links, tables,
  forms, selection, extractor orchestration, caps and partial states, content
  hash stability.
- **Form-value regression (required)** — password / email / card / OTP /
  hidden / textarea values must never appear in an extracted context; only
  structural field keys may exist.
- **Command pipeline** — classification, empty/overlong commands,
  no-content failures, failing handlers, error mapping, supersede and
  cancellation.
- **AI reasoning** — intent resolution, per-intent context minimization,
  prompt separation and injection defense, JSON-only parsing, response trust
  policy, gateway contract and HTTP error mapping, timeout/cancellation,
  safe-Markdown rendering, hostile-page end-to-end scenarios.
- **Action Engine** — typed action validation, plan hashing, single-use
  expiring approvals, freshness, sensitive-field blocking, stop-on-failure,
  retry policy, verification.
- **Workflow engine** — deterministic understanding, the closed state machine
  (no path to `RUNNING` without approval), validation of untrusted proposals,
  planning and ambiguity refusal, session store (single-use approval, one
  workflow per tab, TTL), orchestrator gates and stop conditions, bounded
  observation/replanning, concurrency budgets, adversarial inputs, the
  background message surface, and the Side Panel workflow UI.
- **UI** — Side Panel, Popup, Command Center rendering and interactions,
  settings application, page-insight states, workflow preview → approve →
  verified result.
- **Security** — unsafe URLs, invalid stored data, sanitized errors, message
  rejection.

### Manual verification in Edge (2 minutes)

1. Load `extension/` unpacked; confirm the toolbar icon, popup, Side Panel
   (`Ctrl+Shift+L`) and Command Center all open.
2. On an `https://` article page, capture page insight — stats and *Context
   ready* appear; open the Developer preview JSON and confirm no `value` keys.
3. Run a quick action and a command — results are grounded in the captured
   page.
4. Request a workflow (e.g. `find "features" and open it`), check the preview
   and risk badge, approve it, and watch step-by-step progress with per-step
   verification.
5. Reject or ignore an approval prompt — nothing executes.
6. Open `edge://extensions` — the page is reported as unsupported and capture
   is unavailable.

> An automated browser smoke test is deliberately **not** part of the
> repository: the project must not depend on a browser automation environment.
> `npm run smoke` covers the built bundles without a browser, and the checklist
> above is the manual procedure.

---

## Version & build history

| Phase | Deliverable | Status |
| --- | --- | --- |
| 1 | Extension foundation — Side Panel, Popup, Command Center, typed messaging, storage, command pipeline, shortcut | Delivered |
| 2 | Page Intelligence & Web Context Engine — on-demand bounded extraction, site-access states | Delivered |
| 3 | Real AI Reasoning Engine & Secure Intelligence Gateway — intent resolution, injection-defended prompts, validated responses | Delivered |
| 4 | Safe Action Engine — typed bounded actions with Preview → Permission → Execute → Verify | Delivered |
| 5 | Contextual Workflow Engine — bounded multi-step tasks, hash-bound approvals, per-step verification | Delivered |
| 6+ | Not started | — |

Current release: **CommandLayer 0.4.0**, `manifest_version: 3`, `Phase 5 Task
Intelligence`.

---

## Current limitations

- **Actions and workflows are bounded and explicit.** Six typed actions, at
  most 4 workflow steps of one action each, and always an approval. There is no
  bulk/always-allow mode, no branching, no looping, no cross-tab or multi-page
  work, and no background automation.
- **Deterministic, pattern-based understanding.** Explicit phrasings such as
  `find "pricing"`, `scroll down`, `click the "Save" button`,
  `type "Mumbai" into the "City" field`, `select "India" in the "Country"
  dropdown`, `read this page` are understood locally. Goals that cannot be
  grounded in the captured page are refused
  (`WORKFLOW_TARGET_NOT_FOUND` / `WORKFLOW_TARGET_AMBIGUOUS`) instead of
  guessed; free-form requests fall through to reasoning.
- **Default reasoning is the built-in local mock provider** — fully functional
  and deterministic, but not a large language model. Real-model reasoning
  requires deploying the Secure Gateway and setting `VITE_AI_GATEWAY_URL`.
- **Single page, on demand.** No crawling, link-following, cross-tab context,
  or conversation persistence.
- **Page intelligence is an extraction baseline**, not reader-mode: a
  deterministic readable-content heuristic with fixed caps. Unusual page
  structures may produce imperfect (always bounded) results, flagged
  `partial`; iframes are not captured (`all_frames: false`).
- **Themes** are dark and light (no system-following yet).
- **Dev preview caveats.** `npm run dev` persists settings in memory only and
  cannot reach a real content script, so page insight degrades to *site access
  required* / *no page context* there. The installed extension persists via
  `chrome.storage.local`.

---

## Roadmap

Everything that executes stays bound to the same safety pipeline — preview,
explicit permission, bounded execution, verification:

- multi-page research and cross-tab comparison;
- a wider typed action vocabulary;
- integrations through the integration registry;
- session continuity.

---

## Documentation

- [`docs/action-engine.md`](docs/action-engine.md) — the Safe Action Engine:
  action vocabulary, targeting, permission and execution model, verification,
  limits, failure model.
- [`docs/workflow-engine.md`](docs/workflow-engine.md) — the Contextual
  Workflow Engine: understanding, planning, validation, state machine,
  approval binding, observation and verification, replanning, concurrency,
  privacy, extension points.

---

## License

Internal project — no license distributed.
