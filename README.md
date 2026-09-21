# CommandLayer

**Think once. Execute everywhere.**

CommandLayer is a premium, local-first browser command layer for developers,
founders, and knowledge workers. It is designed to grow into an intelligent
layer that understands your current web context and eventually researches,
understands, creates, automates, and executes work across the web.

> **Phase 2 status:** CommandLayer is an Edge-first browser extension with
> a working **Page Intelligence engine**: on the user's request, a minimal
> content script performs one controlled, read-only extraction of the
> active webpage into a structured, sanitized `PageContext` that the
> background validates and the Side Panel displays. **No AI provider, OAuth
> integration, or autonomous action is implemented.** Commands run through
> a local mock pipeline that honestly reports what it did and did not do.
>
> **CommandLayer does not collect form values, passwords, cookies, browser
> storage, authentication tokens, or browsing history.**

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

## Phase 2 scope — Page Intelligence & Web Context Engine

Phase 2 adds safe, **on-demand** understanding of the active webpage. It is
an extraction phase, **not** an AI phase.

What is included:

- **Content script (extraction-only, on-demand).** Registered in the
  manifest for `http://*/*` and `https://*/*` pages only. It does nothing
  until the background sends an extraction request, then runs one
  deterministic pass over the DOM and replies with a sanitized,
  limit-capped context. No observers, no polling, no activity monitoring.
- **Page Intelligence Engine** (`src/page-intelligence/`) — pure extraction
  modules (metadata, headings, text, links, tables, forms, selection),
  centralized limits, a sanitizer, visibility detection, a lightweight
  content hash, and a strict validator for untrusted responses.
- **Structured `PageContext`** — `url`, `hostname`, `title`, `description`,
  `language`, `canonicalUrl`, `headings` (H1–H4, hierarchy preserved),
  `paragraphs` (readable-text baseline), `links` (normalized, de-duplicated),
  `selectedText` (on-demand, capped), `tables` (headers + rows), `forms`
  (structural metadata only), `contentStats`, `truncated`, `contentHash`,
  `capturedAt`, plus a 7-state status system (`not-requested`, `requesting`,
  `ready`, `partial`, `unsupported`, `permission-required`, `unavailable`).
- **Side Panel Page Insight** — stats line (`12 headings · 84 paragraphs ·
  31 links`), `● Context ready` status, a compact expandable preview (no
  huge raw text by default), and a toggleable developer JSON preview of the
  fully sanitized context.
- **Command pipeline integration** — every command and quick action
  triggers one on-demand capture of the context it needs (Analyze →
  metadata + headings + text + links + tables; Summarize → title + headings
  + main text; Research/Compare → full capture). The mock provider now
  reports: *"Page context captured successfully. The AI reasoning engine
  will be connected in a future phase."* — it never claims an AI analysis
  ran.
- **Security hardening** — the background re-parses every content-script
  response with a strict validator that enforces all limits and rejects
  any form-field `value` key, so nothing untrusted ever reaches the UI.

What is explicitly **not** in Phase 2:

- Real AI providers or any external AI API
- Form **values** of any kind (passwords, credit cards, OTPs, tokens,
  typed private data) — structural metadata only
- Cookies, localStorage, sessionStorage, IndexedDB, or browsing history
- Autonomous clicking, navigation, form submission, or page modification
- Web crawling or following links (current page only)
- Continuous monitoring, MutationObservers, or polling

### Page Intelligence in detail

**Flow (one request → one extraction → one sanitized result):**

```
User ("Analyze this page" / quick action / command)
        ▼
Side Panel / Command Center → cl:get-page-context / cl:command-submit
        ▼
Background: tabs API → URL gate (http/https only)
        ▼
chrome.tabs.sendMessage → content script (one message)
        ▼
Page Intelligence Engine: one deterministic DOM pass (capped, sanitized)
        ▼
Background: strict parsePageContext validation (limits + field allowlists)
        ▼
PageContext → Side Panel (stats + preview + JSON) / command pipeline
```

**What is collected (only, on demand):** page title, URL, hostname,
document language, meta description, canonical URL; H1–H4 heading text;
visible paragraph/list-item text; visible link text + normalized URLs;
current text selection (only if present); table headers/cells; form
**structure** (action, method, field name/type/label/required); content
statistics; a lightweight content hash.

**What is NOT collected (by construction, enforced by tests):**

- **CommandLayer does not collect form values, passwords, cookies,
  browser storage, authentication tokens, or browsing history.**
- No input/textarea/select values — ever. A password field is reported as
  `type: "password"` with no other content.
- No access to localStorage, sessionStorage, IndexedDB, cookies, or
  browser history; the extension does not even request those permissions.
- No hidden content (display/visibility/`[hidden]`/`aria-hidden`/
  zero-size/script/style/template/noscript), no navigation/header/footer
  boilerplate where identifiable, no network requests of any kind from the
  content script.

**Extraction limits (centralized in `src/page-intelligence/limits.ts`):**

| What | Limit |
| ---- | ----- |
| Total main-text characters | 20,000 |
| Paragraphs / characters per paragraph | 60 / 600 |
| Headings / characters per heading | 40 / 160 |
| Links / characters per link text | 80 / 120 |
| Tables / rows / columns / cell characters | 6 / 30 / 12 / 200 |
| Selected text | 2,000 characters |
| Forms / fields / name / label | 8 / 30 / 64 / 80 |
| Title / description / URL | 120 / 300 / 2,048 characters |

Any cap hit sets `truncated: true` and the state to `partial` — content is
never silently dropped. The validator rejects payloads that exceed these
limits, so a hostile or buggy page cannot inflate the message size.

**Supported vs unsupported pages:**

- **Supported:** any `http://` or `https://` web page.
- **Unsupported (graceful `unsupported` state):** browser-internal pages —
  `chrome://`, `edge://`, `about:`, `view-source:`, Web Store, PDF viewer —
  the content script's match patterns never apply there, and the URL gate
  in the background rejects them before any messaging.
- **`permission-required`:** if the user has restricted the extension's
  site access for a page, the capture reports that clearly and points to
  the browser's extension settings instead of failing silently.
- **`unavailable`:** no active tab, missing content-script channel, or a
  response that failed validation.

**Permissions & why:** Phase 2 adds **no permissions and no
`host_permissions`**. The content script is declared with
`content_scripts.matches = ["http://*/*", "https://*/*"]` — the narrowest
match set that still covers the open web, because users may analyze any
page they visit. Messaging to our own manifest-injected script requires no
host grant. Broad matching is documented here because it is deliberate:
it controls *where a read-only extraction script may exist*, what is
collected is the fixed list above, collection happens only on explicit
user action, and the user retains per-site control through the browser's
extension site-access settings.

---

## Architecture

```
src/
├── background/        Service worker: lifecycle, typed message routing,
│                      page-context capture, command dispatch, keyboard cmd
├── content/           Content script (registered; extraction-only)
├── page-intelligence/ Page Intelligence Engine: extractors, limits,
│                      sanitizer, visibility, validator, capture profiles
├── popup/             Compact launcher UI
├── sidepanel/         Primary experience (command + page insight)
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
  (`useCommandPipeline`, `usePageContext`, `usePageIntelligence`,
  `useSettings`) that talk to the background exclusively through the
  message layer.
- **The background never trusts input.** Every message is parsed
  (`parseMessage`), sender-checked, and payload-validated before dispatch.
- **The background never trusts the content script either.** Every
  extraction response passes `parsePageContext`, which re-validates every
  field against the centralized limits and a strict key allowlist (a
  `value` key on a form field fails the whole payload).
- **The content script never acts.** It has no network access in its
  bundle (verified by the smoke test), executes no commands, modifies
  nothing, and only ever answers one message kind.
- **Storage is always validated.** Corrupted or missing values degrade to
  safe defaults; patches are validated before they are written.
- **The AI layer is an interface.** `AIProvider`/`AIRequest`/`AIResponse`/
  `AIError` let future providers plug in without touching the UI or
  dispatcher. Phase 2 still registers only the local mock.

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

Message types: `PING`, `GET_EXTENSION_STATUS`, `GET_CURRENT_PAGE` (basic,
tabs-API only), `GET_PAGE_CONTEXT` (on-demand intelligence capture),
`COMMAND_SUBMIT`, `QUICK_ACTION`, `OPEN_COMMAND_CENTER`, `OPEN_SIDE_PANEL`,
`GET_SETTINGS`, `SET_SETTINGS`.

Background ↔ content script (Phase 2, over `chrome.tabs.sendMessage`):
one request kind, `cl:extract-page-context-request` (protocol v1, optional
section subset), answered with a structured context or a safe failure —
anything else is ignored by the content script.

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

Every command/quick action triggers one on-demand page capture (the
appropriate section set per action), and the mock provider's response is
context-aware and honest: *\"Page context captured successfully. The AI
reasoning engine will be connected in a future phase.\"* when a real
capture is present, or *\"Command received. AI intelligence will be
connected in a future phase.\"* otherwise. The UI never pretends an AI
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
├── content.js           Content script (single IIFE, extraction-only)
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
tab's title/URL; the content script (extraction-only) is declared for
`http/https` pages via `content_scripts` — no host permissions.

**Phase 2 site access:** the Page Insight capture works on any web page by
default. If a capture reports *Site access required*, open
`edge://extensions` → CommandLayer → **Site access** and allow the site —
the extension then works again without any data already captured being
stored or sent anywhere.

### Manual Edge test checklist (Phase 1 + 2)

1. Load `dist/` as an unpacked extension; verify the toolbar icon, popup,
   Side Panel (`Ctrl+Shift+L`), and Command Center all open.
2. On a news/article page: open the Side Panel — the current-page card
   shows the page title + hostname with **Ready**.
3. In **Page insight**, click **Analyze this page** — after a short
   *Capturing page context…* state, the stats line (headings / paragraphs /
   links) and **Context ready** appear; expand **Page details**; toggle the
   **Developer preview** JSON (inspect it: no `value` keys anywhere).
4. Select some text on the page, re-analyze — *Selected text* appears in
   the details.
5. Type `Analyze this page` in the command input — the result reads
   *Page context captured successfully. The AI reasoning engine will be
   connected in a future phase.* (never claims AI analysis ran).
6. Run each quick action — all complete with honest local responses.
7. Open `edge://extensions` — the card shows **Unsupported page**;
   Page insight offers no capture.
8. Restrict a site's access (CommandLayer → Site access → On click) and
   re-analyze that site — **Site access required** is shown with a
   *Try again* affordance.
9. On a huge page (long documentation) — stats appear, and if limits are
   hit the state reads **Partial context** with *capped by extraction
   limits*.
10. DevTools → Network on any analyzed page: the content script makes
    zero network requests; no console errors on `chrome://` pages.

---

## Testing

```bash
npm test
```

Coverage includes:

- **Manifest/config validation** — MV3 shape, identity, worker, popup,
  side panel, keyboard command, content-script registration (http/https
  matches only, no `<all_urls>`), minimal permissions (no host
  permissions), icon assets.
- **Storage** — defaults, updates, partial updates, corrupted values,
  wrong-typed fields, failing storage backends, preference validation.
- **Messaging** — valid envelopes, malformed messages, unknown types,
  response parsing, sender trust, payload validation.
- **Page context (basic)** — title/URL/hostname extraction, internal
  browser pages, missing data, unsafe schemes, title sanitization.
- **Page Intelligence engine** — metadata (garbage rejection, canonical
  resolution), headings (hierarchy, empty/hidden, caps), readable text
  (article preference, nav/header/footer exclusion, display/visibility/
  hidden/aria-hidden/zero-size exclusion, script/template exclusion,
  de-duplication, per-paragraph + total caps), links (normalization,
  duplicates, non-http rejection, rel subset, caps), tables (headers,
  empty cells, nested tables, row/column caps), forms (labels, required,
  type normalization, caps), selection (on-demand, caps, hostile API),
  extractor orchestration (consistency, partial state, section subsets,
  content hash stability).
- **Form-value regression (required)** — `<input type="password"
  value="SECRET">` and email/credit-card/OTP/hidden/textarea values must
  never appear in extracted forms or in a full `PageContext`; only
  structural `{ name, type, label, required }` keys may exist.
- **Validator (untrusted payloads)** — malformed/oversized/malicious
  content-script responses are rejected, including any `value` key or
  unknown key on form fields; valid responses round-trip.
- **Content script** — valid/invalid message shapes, section pass-through,
  safe failure on extraction errors, real end-to-end extraction.
- **Background capture** — no-tab, unsupported-URL, permission-required,
  real content↔background round trip, malicious/garbage response
  handling, section subset pass-through.
- **Command pipeline** — command creation, quick actions, empty/overlong
  commands, context-aware mock responses (never claims AI ran), failing
  handlers, AI error mapping.
- **UI** — Side Panel (including the on-demand Page Insight capture:
  stats, expandable preview, developer JSON, site-access guidance,
  unsupported-page and idle states), Popup, and Command Center rendering,
  command input (Enter / Shift+Enter / disabled / loading / clear),
  quick actions, loading/error/success states, settings (theme + reduce
  motion applied to the document), first-run tip.
- **Security** — malformed message rejection, unsafe URL handling,
  invalid stored data, error sanitization (no stack traces leak).

`npm run smoke` additionally loads the *built* `dist/background.js` **and**
the *built* `dist/content.js` (the latter into a jsdom web-page fixture)
with a chrome shim and exercises real end-to-end round-trips, including
the form-value guarantees on the production bundles.

---

## Security principles

- **Minimal permissions:** `storage`, `tabs` (active tab title/URL only),
  `sidePanel`, `commands`. **No host permissions, no `<all_urls>`.** No
  history, cookies, downloads, or scripting access. The content script is
  scoped by `content_scripts` matches (`http://*/*`, `https://*/*`) —
  documented under *Phase 2 scope*.
- **Sensitive-data protection (Phase 2):** **CommandLayer does not
  collect form values, passwords, cookies, browser storage,
  authentication tokens, or browsing history.** Forms are structural
  metadata only; passwords appear as `type: "password"` and nothing else.
  The guarantee is enforced in three layers — the extractor never reads
  `.value`, the validator rejects any `value` key (and unknown field
  keys) in content-script responses, and regression tests assert the
  absence of secrets end-to-end.
- **Strict TypeScript** with `noUncheckedIndexedAccess`; no `any` leaks
  across boundaries.
- **Never trust input:** messages, webpages, and storage are validated
  (`parseMessage`, payload validators, `parseStoredSettings`,
  `parseSafeUrl`, `sanitizeText`, `parsePageContext`).
- **On-demand by design:** page content is read only when the user asks
  (capture button, command, or quick action) — one controlled extraction,
  no observers, no polling, no monitoring.
- **Safe errors:** the UI only ever renders user-safe messages from a
  fixed vocabulary — never stack traces or raw exceptions.
- **No secrets, no eval, no remote code:** no API keys, no `eval`/
  `Function`, no remote scripts or CDN dependencies; everything is local.
- **Honest states:** the mock pipeline says so; page context exposes all
  seven states — Not requested / Capturing / Ready / Partial / Unsupported
  / Permission required / Unavailable.

---

## Current limitations (Phase 2)

- The command pipeline is still a **local mock** — commands receive real
  page context but are acknowledged, not executed intelligently. The AI
  reasoning engine is a future phase.
- Page intelligence is an **extraction baseline**, not a reader-mode
  algorithm: it uses a deterministic readable-content heuristic (article/
  main preference, boilerplate exclusion) and fixed caps. Very unusual
  page structures may yield imperfect (always bounded) results, flagged
  as `partial` when truncated.
- Extraction runs in the page's main world of the top frame
  (`all_frames: false`) — iframes are not captured.
- Theme options are **dark and light** (system-following can be added
  later without schema changes).
- The dev preview (`npm run dev`) persists settings in memory only and
  cannot reach a real content script, so Page Insight degrades to
  *Site access required* / *No page context* there — a real state, not a
  bug. The real extension persists via `chrome.storage.local`.
- The Edge load checklist is a manual procedure; no browser automation is
  bundled with the repo.

---

## Roadmap direction

- **Phase 3:** connect real AI reasoning through the existing
  `AIProvider` interface, consuming the structured `PageContext` this
  phase produces; stream command results.
- **Phase 4:** web research & summarization built on page intelligence
  (multi-page context, with user-controlled scope).
- **Phase 5:** permissioned actions (action registry + confirmation
  flows) for read/write operations on the current page.
- **Phase 6:** integrations (GitHub, Gmail, Slack, Notion, Jira) through
  the integration registry, with user-controlled OAuth.
- **Phase 7:** persistent memory and multi-step task execution.

Each phase builds on the abstractions established here — no rewrites of
the UI, messaging, storage, pipeline, or page-intelligence contracts are
anticipated.

---

## License

Internal project — no license distributed.
