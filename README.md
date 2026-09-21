# CommandLayer

**Think once. Execute everywhere.**

CommandLayer is a premium, local-first browser command layer for developers,
founders, and knowledge workers. It is designed to grow into an intelligent
layer that understands your current web context and eventually researches,
understands, creates, automates, and executes work across the web.

> **Phase 1 status:** CommandLayer is an Edge-first browser extension that
> establishes the foundation — architecture, premium UI shell, command
> pipeline, storage, typed messaging, and security — for the intelligence
> that comes in later phases. **No AI provider, OAuth integration, or
> autonomous action is implemented in Phase 1.** Commands run through a
> local mock pipeline and are labeled as such.

Built for **Microsoft Edge** (Manifest V3), with architecture that stays
compatible with Chromium WebExtension APIs where practical.

---

## Phase 1 scope

What is included:

- **Side Panel** — the primary experience: command input, quick actions
  (Analyze / Research / Summarize / Compare), live current-page context,
  and inline settings.
- **Popup** — a compact launcher: extension status, current-page status,
  "Open Command Center" / "Open Side Panel" actions, shortcut info.
- **Command Center** — a full-window command experience with a
  session-only command log.
- **Command pipeline** — `Quick Action / Command Input → CommandRequest →
  CommandDispatcher → (mock) AI handler → CommandResult`. The UI only ever
  produces structured, validated requests.
- **Current-page context** — title, URL, hostname, availability state
  (`ready` / `unsupported` / `unavailable`). No scraping, no history.
- **Storage abstraction** — validated settings, namespaced preferences,
  graceful recovery from corrupted data.
- **Typed messaging** — versioned envelopes with request ids, sender trust
  checks, and safe rejection of malformed/unknown messages.
- **Keyboard shortcut** — `Ctrl+Shift+L` (`⌘⇧L` on macOS) opens the
  CommandLayer experience.
- **Settings** — theme (dark/light), reduce motion, shortcut info,
  privacy, version. Every control is a real, working feature.
- **Design system** — dark-first tokens, restrained indigo accent, subtle
  glass surfaces, custom SVG iconography, accessible and reduced-motion
  aware.
- **Future-phase abstractions** — AI providers, actions, integrations, and
  session-scoped memory contracts (no implementations beyond the mock).

What is explicitly **not** in Phase 1:

- Real AI APIs (OpenAI, Gemini, Claude, or any other provider)
- OAuth / third-party integrations (GitHub, Gmail, Slack, Notion, Jira, …)
- Autonomous clicking, form submission, or multi-step automation
- Web research agents, long-term AI memory, remote backends, accounts,
  subscriptions, or payments
- `<all_urls>` host permissions, history, cookies, or downloads access

---

## Architecture

```
src/
├── background/        Service worker: lifecycle, typed message routing,
│                      command dispatch wiring, keyboard command
├── content/           Content-script foundation (not registered yet)
├── popup/             Compact launcher UI
├── sidepanel/         Primary Phase 1 experience
├── command-center/    Full-window command UI + session log
├── ai/                AI abstraction (types + local mock provider)
├── actions/           Action abstraction (types + registry, empty in P1)
├── integrations/      Integration architecture (registry, empty in P1)
├── memory/            Memory abstraction (session-only store)
├── permissions/       Permission utilities
├── security/          Safe URL parsing, text sanitization, safe errors
├── storage/           Settings, preferences, storage backend
├── shared/            Types, constants, messaging, hooks, UI components,
│                      utilities, validation
└── styles/            Design tokens, base styles, Tailwind theme mapping
```

Boundaries:

- **No business logic in React components.** UI surfaces use shared hooks
  (`useCommandPipeline`, `usePageContext`, `useSettings`) that talk to the
  background exclusively through the message layer.
- **The background never trusts input.** Every message is parsed
  (`parseMessage`), sender-checked, and payload-validated before dispatch.
- **Storage is always validated.** Corrupted or missing values degrade to
  safe defaults; patches are validated before they are written.
- **The AI layer is an interface.** `AIProvider`/`AIRequest`/`AIResponse`/
  `AIError` let future providers plug in without touching the UI or
  dispatcher. Phase 1 registers only a local mock.

### Message flow

```
Popup / Side Panel / Command Center
        │  sendMessage(type, payload)
        ▼
   Message Layer (typed envelope { v, id, type, payload })
        ▼
Background service worker (parse → trust check → payload validation)
        ▼
Handlers: page context · command dispatcher · settings · openers
        ▼
   MessageResult { ok: true, data } | { ok: false, error }
```

Message types: `PING`, `GET_EXTENSION_STATUS`, `GET_CURRENT_PAGE`,
`COMMAND_SUBMIT`, `QUICK_ACTION`, `OPEN_COMMAND_CENTER`, `OPEN_SIDE_PANEL`,
`GET_SETTINGS`, `SET_SETTINGS`.

### Command pipeline

```
Quick Action ──▶ CommandRequest (structured, validated) ──▶ CommandDispatcher
Command Input ─▶                                          │
                                                         ▼
                              CommandHandler (Phase 1: AICommandHandler
                              → local mock provider; future: real providers)
                                                         ▼
                                        CommandResult (user-safe)
```

The mock provider's response is honest: *"Command received. AI intelligence
will be connected in a future phase."* The UI never pretends an AI
operation occurred.

---

## Technology stack

- **TypeScript** (strict, `noUncheckedIndexedAccess`)
- **React 19**
- **Vite 7** (multi-entry UI build + separate single-file worker build)
- **Tailwind CSS 4** (design-token driven, dark/light themes)
- **Manifest V3** for Microsoft Edge / Chromium
- **ESLint 9** (typescript-eslint, react-hooks, jsx-a11y, react-refresh)
- **Vitest** + Testing Library (unit, integration, and UI tests)

---

## Local development

```bash
npm install
npm run dev        # Vite dev server — preview the three UI surfaces in a
                   # regular browser (http://localhost:5173/sidepanel.html,
                   # /popup.html, /command-center.html). Without browser
                   # APIs the app runs in "preview" mode: the full local
                   # pipeline works, page context shows as unavailable, and
                   # settings persist in memory only.
```

To iterate on the actual extension, rebuild and reload (see below):

```bash
npm run build      # production build into dist/
```

Additional scripts:

| Script              | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `npm run build`     | Production build → `dist/` (worker + 3 UI surfaces)        |
| `npm run lint`      | ESLint over the whole repo                                 |
| `npm run typecheck` | `tsc --noEmit`                                             |
| `npm test`          | Vitest (unit + UI tests)                                   |
| `npm run test:watch`| Vitest in watch mode                                       |
| `npm run icons`     | Regenerate PNG icons (dependency-free generator)           |
| `npm run smoke`     | Build, then smoke-test the built service worker in Node    |
| `npm run clean`     | Remove `dist/`                                             |
| `npm run check`     | lint + typecheck + test + build                            |

> **Browser automation note:** an optional Playwright-based browser smoke
> test is *not* part of the project by design — the repo must not depend on
> a browser automation environment. `npm run smoke` covers the built
> worker without a browser; the Edge load-test checklist below is the
> manual procedure.

---

## Production build

```bash
npm run build
```

Produces an extension-ready `dist/`:

```
dist/
├── manifest.json        Manifest V3
├── background.js        Service worker (single ES module)
├── popup.html
├── sidepanel.html
├── command-center.html
├── assets/              Bundled JS + CSS
└── icons/               16/32/48/128 PNG + brand SVG
```

`npm run build` is the exact directory to load into Edge.

---

## Loading into Microsoft Edge

1. Build the extension: `npm run build`
2. Open `edge://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `dist/` folder
5. Click the CommandLayer toolbar icon for the **popup**
6. Click **Open Side Panel** in the popup — or press **Ctrl+Shift+L** —
   for the **Side Panel**
7. **Open Command Center** launches the full-window experience

### Keyboard shortcut

- Windows/Linux: `Ctrl + Shift + L`
- macOS: `⌘ + Shift + L`

The shortcut opens the Side Panel for the active tab; if the side panel
cannot be opened it falls back to the Command Center tab. To change or
view the shortcut: `edge://extensions` → Keyboard shortcuts.

**Edge API note:** the side panel opens only in response to a user gesture
(shortcut press, popup click, or toolbar interaction) — this is a platform
constraint, and the fallback behavior above keeps the shortcut useful in
every case. The `tabs` permission is used solely to read the *active*
tab's title/URL for the current-page context.

---

## Testing

```bash
npm test
```

Coverage includes:

- **Manifest/config validation** — MV3 shape, identity, worker, popup,
  side panel, keyboard command, minimal permissions, icon assets.
- **Storage** — defaults, updates, partial updates, corrupted values,
  wrong-typed fields, failing storage backends, preference validation.
- **Messaging** — valid envelopes, malformed messages, unknown types,
  response parsing, sender trust, payload validation.
- **Page context** — title/URL/hostname extraction, internal browser
  pages, missing data, unsafe schemes, title sanitization.
- **Command pipeline** — command creation, quick actions, empty/overlong
  commands, mock responses, failing handlers, AI error mapping.
- **UI** — Side Panel, Popup, and Command Center rendering, command input
  (Enter / Shift+Enter / disabled / loading / clear), quick actions,
  loading/error/success states, settings (theme + reduce motion applied
  to the document), first-run tip.
- **Security** — malformed message rejection, unsafe URL handling,
  invalid stored data, error sanitization (no stack traces leak).

`npm run smoke` additionally loads the *built* `dist/background.js` with a
chrome shim and exercises real message round-trips.

---

## Security principles

- **Minimal permissions:** `storage`, `tabs` (active tab title/URL only),
  `sidePanel`, `commands`. **No host permissions.** No `<all_urls>`,
  history, cookies, downloads, or scripting access.
- **Strict TypeScript** with `noUncheckedIndexedAccess`; no `any` leaks
  across boundaries.
- **Never trust input:** messages, webpages, and storage are validated
  (`parseMessage`, payload validators, `parseStoredSettings`,
  `parseSafeUrl`, `sanitizeText`).
- **Safe errors:** the UI only ever renders user-safe messages from a
  fixed vocabulary — never stack traces or raw exceptions.
- **No secrets, no eval, no remote code:** no API keys, no `eval`/
  `Function`, no remote scripts or CDN dependencies; everything is local.
- **Honest states:** the mock pipeline says so; the UI distinguishes
  Ready / Processing / Success / Error / Unavailable / Unsupported /
  No page context.

---

## Current limitations (Phase 1)

- The command pipeline is a **local mock** — commands are acknowledged,
  not executed intelligently.
- Page context is title/URL only — no DOM reading, summarization, or
  webpage intelligence (the content-script foundation exists but is not
  registered).
- Theme options are **dark and light** (system-following can be added
  later without schema changes).
- The dev preview (`npm run dev`) persists settings in memory only; the
  real extension persists via `chrome.storage.local`.
- The Edge load checklist is a manual procedure; no browser automation is
  bundled with the repo.

---

## Roadmap direction

- **Phase 2:** connect real AI providers through the existing
  `AIProvider` interface; stream command results.
- **Phase 3:** web research & summarization over current-page context via
  the registered content script.
- **Phase 4:** permissioned actions (action registry + confirmation
  flows) for read/write operations on the current page.
- **Phase 5:** integrations (GitHub, Gmail, Slack, Notion, Jira) through
  the integration registry, with user-controlled OAuth.
- **Phase 6:** persistent memory and multi-step task execution.

Each phase builds on the abstractions established here — no rewrites of
the UI, messaging, storage, or pipeline are anticipated.

---

## License

Internal project — no license distributed.
