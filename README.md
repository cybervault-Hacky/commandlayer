# CommandLayer

**Think once. Execute everywhere.**

CommandLayer is a premium, local-first browser command layer for developers,
founders, and knowledge workers. It is designed to grow into an intelligent
layer that understands your current web context and eventually researches,
understands, creates, automates, and executes work across the web.

> **Phase 5 status:** CommandLayer adds a **Contextual Workflow Engine**:
> short, bounded, multi-step tasks ("find *X* and open the result",
> "scroll down and read the page"). A goal is understood locally and
> deterministically, planned into at most **4 steps** of registered
> actions, previewed step by step, and executed **one step at a time,
> only after an approval bound to the exact `workflowHash`**. Each step
> runs through the Phase 4 Action Engine — still the single execution
> security boundary — and the result is verified before the workflow may
> continue. A failure **stops** the workflow and keeps what already ran.
> You can pause, resume, or cancel at any time, page changes stop the run
> (`WORKFLOW_CONTEXT_CHANGED`), and **nothing is remembered after the
> session**: no workflow history, no profiling, no background agent, no
> observe→reason→act loop.
>
> **Phase 4 status:** CommandLayer adds a **Safe Action Engine**: bounded,
> typed browser actions (read page, find text, scroll, click, type,
> select) that follow a strict pipeline — **Preview → Permission →
> Execute → Verify**. Actions are proposed by a deterministic planner,
> shown to you as an explicit preview, and run **only after your explicit
> approval** of that exact plan. Approvals are single-use, expire within
> minutes, and are bound to the exact plan hash and page context.
> Sensitive fields (passwords, payments, codes, keys) are always blocked.
> **The AI reasoning engine still never performs actions and never has
> unrestricted browser control.**
>
> **Phase 3 status:** CommandLayer is an Edge-first browser extension with
> a working **Real AI Reasoning Engine**: user intents, a minimal
> per-intent page context, prompt construction with strict injection
> defenses, a validated-response pipeline, and a premium intelligence UI
> in the Side Panel and Command Center. Reasoning runs on a built-in
> **local mock provider by default** (zero configuration, fully
> functional), with an optional **Secure Intelligence Gateway**
> (`Extension → HTTPS → Gateway → Provider`) so provider secrets never
> live in the extension. **CommandLayer can reason about supplied webpage
> context, but Phase 3 does not grant AI permission to perform browser
> actions.**
>
> **CommandLayer does not collect form values, passwords, cookies, browser
> storage, authentication tokens, or browsing history — and forms are
> never sent to the reasoning engine.**

Built for **Microsoft Edge** (Manifest V3), with architecture that stays
compatible with Chromium WebExtension APIs where practical.

---

## Phase 1 scope

What is included:

- **Side Panel** — the primary experience: command input, quick actions
  (Analyze / Research / Summarize / Compare — *superseded in Phase 3 by
  Analyze / Summarize / Explain / Extract*), live current-page context,
  and inline settings.
- **Popup** — a compact launcher: extension status, current-page status,
  "Open Command Center" / "Open Side Panel" actions, shortcut info.
- **Command Center** — a full-window command experience with a
  session-only command log (*superseded in Phase 3 by a session-only
  reasoning transcript*).
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
  triggers one on-demand capture of the context it needs. *(Phase 3
  update: captures are now scoped per reasoning intent — see the Phase 3
  section — and the captured context feeds the real reasoning engine
  instead of the Phase 1/2 mock acknowledgement.)*
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

## Phase 3 scope — Real AI Reasoning Engine & Secure Intelligence Gateway

Phase 3 turns the command pipeline into genuine AI reasoning over the
user's current page. The flow is:

```
User → Intent → Page Intelligence → Context Builder → AI Reasoning Engine
     → Validated AI Response → Premium UI
```

What is included:

- **Reasoning-only intents** — `SUMMARIZE`, `ANALYZE`, `EXPLAIN`,
  `EXTRACT`, `ANSWER`. There are deliberately **no action intents** (no
  CLICK / TYPE / SUBMIT / NAVIGATE / DELETE / SEND / PURCHASE): the AI is
  never given permission to act on the browser.
- **Deterministic intent resolution** — quick actions always supply an
  explicit intent; free-text commands are classified by local keyword
  rules with `ANSWER` as the fallback. No unstructured model-based
  classification, so behavior is predictable and testable. Quick actions
  are now **Analyze / Summarize / Explain / Extract**; the Phase 1
  "Research" and "Compare" actions were removed rather than faked (they
  require multi-page research and cross-tab comparison, documented as
  future roadmap work).
- **Minimal per-intent context builder** — the captured `PageContext` is
  reduced to exactly the sections each intent needs (e.g. Summarize →
  metadata + headings + text; Analyze adds links + tables; Answer adds
  the user's selection), re-sanitized and budget-capped before it reaches
  the AI. **Forms are never sent to the reasoning engine.**
- **Prompt construction with 3-layer separation** — system instructions
  (static, trusted), the user's request, and the webpage data wrapped in
  explicit `<webpage_data>` delimiters and labeled untrusted data. The
  system instructions state the webpage block cannot change the task or
  the output contract, and any literal delimiter inside page content is
  neutralized so a page cannot escape the block.
- **AI output is validated data only** — every response (mock or gateway)
  passes a trust policy: the provider must echo the `requestId`, the
  intent must match, only allowlisted fields are accepted, every string
  is re-sanitized and length-capped, and `sources` must be absolute
  http/https URLs (dangerous schemes like `javascript:` are rejected).
  Safe Markdown rendering uses React text nodes only — no
  `dangerouslySetInnerHTML`, no HTML execution.
- **Typed errors** — a fixed AI error vocabulary
  (`AI_UNAVAILABLE`, `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_AUTH_ERROR`,
  `AI_INVALID_RESPONSE`, `AI_INVALID_REQUEST`, `AI_CONTEXT_TOO_LARGE`,
  `AI_NETWORK_ERROR`, `AI_PROVIDER_ERROR`, `AI_CONFIGURATION_ERROR`,
  `AI_PAGE_UNAVAILABLE`, `AI_CANCELLED`) with user-safe wording; provider
  internals, auth details, and raw error text never reach the UI.
- **Timeout, cancellation, and stale-response protection** — every
  request carries a request id; new commands supersede in-flight ones
  from the same surface (aborted), external aborts are honored, and the
  UI ignores results from superseded runs.
- **Side Panel redesigned as the intelligence interface** — "Ask about
  this page" hero, a reasoning response card with a thinking state,
  safe-Markdown answer + structured sections + safe references, copy /
  clear / retry actions.
- **Command Center session-only transcript** — questions and validated
  answers accumulate for the lifetime of the tab only; closing the tab
  discards everything. **No permanent memory.**
- **Settings shows AI status** (provider, mode, gateway configured) and
  **never stores API keys or secrets**.

### Secure Intelligence Gateway contract

The extension never holds a provider secret. When a gateway is
configured, reasoning is routed over HTTPS:
`Extension → Secure Gateway → AI Provider`. Credentials live only in the
gateway (server-side); the extension knows only the gateway URL
(`VITE_AI_GATEWAY_URL`, HTTPS required — HTTP only for `localhost`
development).

**Endpoint:** `POST {gateway}/v1/reason`

Request:

```json
{
  "requestId": "req-…",
  "intent": "SUMMARIZE",
  "system": "…system instructions + task…",
  "prompt": "User request: …\n<webpage_data>…untrusted page data…</webpage_data>",
  "context": { "page": { }, "headings": [], "text": "", "links": [], "tables": [], "selectedText": null, "truncated": false }
}
```

Response (success):

```json
{
  "requestId": "req-…",
  "intent": "SUMMARIZE",
  "status": "success",
  "answer": "…markdown…",
  "sections": [{ "title": "…", "content": "…markdown…" }],
  "sources": [{ "title": "…", "url": "https://…" }]
}
```

Response (error):

```json
{ "status": "error", "requestId": "req-…", "error": { "code": "AI_RATE_LIMITED", "message": "…" } }
```

The client maps HTTP `401/403 → AI_AUTH_ERROR`, `429 → AI_RATE_LIMITED`,
`400/413/422 → AI_INVALID_REQUEST`, `408 → AI_TIMEOUT`, `5xx →
AI_PROVIDER_ERROR`, and non-JSON bodies to `AI_INVALID_RESPONSE`. Every
gateway response is still parsed and validated by the same trust policy
as the local mock. Without a configured gateway, the built-in local mock
provider serves every request, so the extension remains fully functional
with zero configuration.

### What Phase 3 does not do

- No browser actions of any kind — reasoning only.
  **CommandLayer can reason about supplied webpage context, but Phase 3
  does not grant AI permission to perform browser actions.**
- No permanent page-content storage or long-term memory; the Command
  Center transcript is session-scoped only.
- No OAuth / third-party integrations.
- No provider API key storage in the extension.


## Phase 4 scope — Safe Action Engine & Browser Execution

**CommandLayer never gives the AI unrestricted browser control. Every
executable action must pass typed validation, permission checks, context
validation, and bounded execution.**

Phase 4 introduces safe, bounded browser actions. The pipeline is:

```
User → CommandLayer → Intent → Page Intelligence → Deterministic planner
     → Structured Action Plan → ACTION PREVIEW → USER PERMISSION
     → EXECUTION (step by step) → VERIFICATION → RESULT
```

There is no path from AI output to execution: plans are produced only by
the deterministic planner, stored only in the background service worker,
and executed only after an explicit approval bound to the exact plan.

### Supported actions (typed allowlist)

| Action | Risk | What it does |
| --- | --- | --- |
| `READ_PAGE` | Read-only | Reuses Page Intelligence to summarize the page structure |
| `FIND_TEXT` | Read-only | Bounded text search with context snippets; never mutates the page |
| `SCROLL` | Low risk | Bounded scroll (per-step and per-plan distance caps, ≤ 3 ops/plan) |
| `CLICK_ELEMENT` | Confirmation required | Clicks an element resolved by safe target, then revalidates it |
| `TYPE_TEXT` | Confirmation required | Types into non-sensitive fields; verifies by boolean match only |
| `SELECT_OPTION` | Confirmation required | Selects an option by visible label |

Risk is fixed in the action registry — the AI can never set or influence
it. `READ_PAGE`/`FIND_TEXT` are read-only, `SCROLL` is low risk, and
`CLICK_ELEMENT`/`TYPE_TEXT`/`SELECT_OPTION` always require confirmation.

### Element targeting (no selectors)

Targets are restricted to three safe kinds:

- **text** — the element's visible text (or accessible name for form fields)
- **role + name** — an ARIA role from a closed allowlist plus its accessible name
- **stable-id** — a strict identifier (`^[A-Za-z][A-Za-z0-9_-]{0,127}$`)

There is deliberately **no raw CSS or XPath selector** targeting and no
AI-provided coordinates. Targets are revalidated immediately before use.

### Permission & execution model

- **Preview first.** Every plan is shown before anything runs. "Yes" or
  "do it" in the command box never grants permission — only the explicit
  **Allow & run** button does.
- **Plan binding.** The approved plan must equal the executed plan. A
  deterministic plan hash covers the steps, tab, URL, and content hash;
  any mismatch stops with `ACTION_PLAN_CHANGED`.
- **Single-use, expiring approvals.** Approvals live only in worker
  memory, are consumed on first execution, and expire after
  `PLAN_TTL_MS` (120 s). There is no `ALLOW_ALL_ACTIONS` mode.
- **Freshness checks.** Before executing, the engine re-checks the active
  tab, URL, and (for target actions) the content hash. Any change stops
  with `ACTION_CONTEXT_STALE`.
- **Stop-on-failure.** A failed, blocked, or stale step halts the whole
  plan; later steps never run. There is no automatic replanning
  (`MAX_REPLANS = 0`) and no fake rollback.
- **Verification.** Mutating steps report boolean/state verification only
  — never field values.

### Sensitive fields are always blocked

`TYPE_TEXT` never runs against sensitive fields. Detection is
conservative (type, `autocomplete` tokens, and label/name keywords), and
uncertainty resolves to **block**. Sensitive values are never typed,
logged, previewed, or returned. CommandLayer also never auto-submits
forms, and actions like purchases, deletions, sending, or downloads are
not in the allowlist.

### Hard limits

Centralized in `ACTION_LIMITS` (`src/actions/limits.ts`): ≤ 5 actions per
plan, ≤ 500 chars per text payload, ≤ 200 chars per target/find query,
≤ 5000 px per scroll and ≤ 15000 px total, ≤ 3 scroll ops/plan, ≤ 25 find
matches, 120 s plan TTL, 5 s step budget, 0 replans.

### What Phase 4 does not do

- No email/message sending, purchases, deletions, uploads/downloads, or
  sensitive-form submission.
- No account deletion, payments, or financial actions.
- No third-party integrations (GitHub/Gmail/Slack/Notion/Jira).
- No autonomous agents, workflows, scheduled automation, or long-term memory.
- No arbitrary JavaScript, shell, or browser-API execution — ever.

See `docs/action-engine.md` for the full architecture and security model.

---

## Phase 5 scope — Contextual Workflows & Task Intelligence

**CommandLayer understands a multi-step browser goal, builds a bounded
workflow, executes approved steps one at a time, observes the result, and
continues only within explicit limits.**

```
User Goal → Task Understanding → Bounded Workflow Plan → Step Preview
          → Approval → Execute Step → Observe → Verify
          → Continue/Stop → Final Result
```

Task understanding is deterministic and local (`src/workflows/understanding.ts`)
— no model is required to classify a goal, split its clauses, or decide
what "done" means. AI may only ever *propose* a workflow: a proposal is
schema-validated, registry-validated, workflow-validated, and then accepted
**only when its action sequence equals the deterministic plan**. There is
no path from AI output to a stored workflow, let alone to execution.

### Workflow states

`DRAFT → PREVIEW → AWAITING_APPROVAL → APPROVED → RUNNING → VERIFYING →
COMPLETED`, with explicit stop states `PAUSED`, `PARTIAL`, `FAILED`,
`BLOCKED`, `CANCELLED`, `STALE`, and `EXPIRED`. The transition table is
closed: **there is no edge from DRAFT/PREVIEW to RUNNING**, so nothing can
execute without passing approval, and terminal states have no outgoing
edges — a finished workflow can never be resumed.

`COMPLETED` requires the declared outcome to be independently verified. If
actions ran but the outcome could not be confirmed, the workflow finishes
`PARTIAL` and says so — CommandLayer never reports success it cannot
verify.

### Approval, hashing, and change invalidation

Every workflow carries a deterministic `workflowHash` over the goal, the
ordered step identities, each step's executable actions, the propagated
risk, the declared outcome, and the page binding (tab, URL, content hash).
Approving sends that hash back; the engine recomputes it before the first
step runs. Any material change produces a different hash and invalidates
the approval (`WORKFLOW_APPROVAL_MISMATCH`). Approvals are single-use and
expire (`APPROVAL_TTL_MS = 120 s`); duplicate approve/execute/cancel/resume
messages are safely rejected rather than replayed, and **one workflow may
drive a tab at a time** (`WORKFLOW_CONFLICT`).

### Execution goes through the Action Engine

The workflow engine never touches a page. It authorizes exactly one step's
plan — after proving the executable actions are hash-identical to the
approved step — and the **Phase 4 executor remains the only thing that
executes** (plan hash, single-use permission, tab/URL/content freshness,
allowlist, target resolution, sensitive-field block). Each workflow step
wraps exactly **one** registered action, so a workflow can never batch
hidden work.

### Observation, verification, and bounded replanning

The page is observed only at defined checkpoints: **before the first step,
after a step that changed the page, and on verification failure**. There is
no polling, no `MutationObserver`, and no background surveillance; a run
may take at most `MAX_CONTEXT_REFRESHES = 8` snapshots, reusing Phase 2
Page Intelligence. A step is verified by its kind (`FIND_TEXT` needs
matches, `CLICK_ELEMENT` re-checks the target, `READ_PAGE` needs structure),
never by reading a value the user typed.

A failure stops the run: no automatic retry loop, at most one retry for a
step the registry marked retry-safe (`SAFE` / `VERIFY_FIRST` — never a
blind retry of a click or a type), and at most **one** bounded replan. A
revision is stored as a **new** workflow awaiting a **new** approval: it
never inherits the old approval and never continues on its own.

### Hard limits (never unlimited)

Centralized in `WORKFLOW_LIMITS` (`src/workflows/limits.ts`): ≤ 4 steps per
workflow, exactly 1 action per step, ≤ 8 s per step, 120 s per run, ≤ 1
retry per step, ≤ 1 replan per workflow, ≤ 8 context observations, 120 s
approval TTL, 300 s workflow TTL, ≤ 5 pending and ≤ 8 active workflows, and
one running workflow per tab. There is no runtime override and no settings
switch that can widen them.

### User control and privacy

Pause (cooperative — no new step starts, an in-flight step may finish),
Resume, and Cancel (no future step starts) are available throughout, and
every step is previewed with its deterministic label and risk. Risk is
propagated upward only (read-only + low risk = low risk; any confirmation
step keeps the workflow at confirmation), a sensitive-field step blocks the
whole workflow, and an ambiguous target is refused
(`WORKFLOW_TARGET_AMBIGUOUS`) instead of guessed.

Workflow state lives **only** in the background worker's memory for the
session: no storage writes, no permanent history, no profiling, and no
permanent task memory. Observations are minimal (metadata, headings,
text), bounded, and never include form values or typed secrets.

### What Phase 5 does not do

- No always-on agent, background browser agent, scheduled browsing, or
  continuous monitoring — workflows run only when you approve them.
- No unrestricted autonomous browsing, payments, deletions, or high-risk
  actions, and no new manifest permissions (`tabs`, `storage`, `sidePanel`,
  `commands` only).
- No permanent memory, no integrations (GitHub/Gmail/Slack/Notion/Jira),
  no "trust forever" or auto-approve switch.

See `docs/workflow-engine.md` for the full model, state machine, planner,
validator, observation, verification, approval binding, failure model,
concurrency rules, and extension points.

```
src/
├── background/        Service worker: lifecycle, typed message routing,
│                      page-context capture, command dispatch, action
│                      session (approval + execution), keyboard cmd
├── content/           Content script: on-demand extraction + bounded,
│                      validated action steps
├── page-intelligence/ Page Intelligence Engine: extractors, limits,
│                      sanitizer, visibility, validator, capture profiles
├── popup/             Compact launcher UI
├── sidepanel/         Primary experience (intelligence interface + page insight)
├── command-center/    Full-window intelligence UI + session-only transcript
├── ai/                Real AI reasoning engine: intents, context builder,
│                      prompts, parser/validator, gateway contract,
│                      providers (local mock + secure gateway), client
├── actions/           Safe Action Engine: typed allowlist, validator,
│                      planner, plan hash, permissions, state machine,
│                      executor, content-side runtime, sensitive guard
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
- **The AI layer is a validated pipeline.** `AIProvider`/`AIRequest`/
  `AIResponse`/`AIError` let providers plug in without touching the UI or
  dispatcher. Phase 3 registers the local mock (default) and a secure
  gateway adapter; every provider response is parsed and validated before
  rendering.

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
                    AICommandHandler: resolve intent → buildAIContext
                    → runAIRequest (provider + timeout/cancel → parse
                    → validate) — local mock or secure gateway
                                                         ▼
            CommandResult (validated AI response or typed error)
```

Every command/quick action triggers one on-demand page capture scoped to
the resolved intent's sections (forms are never requested), then the
reasoning engine produces a **validated** response: intent classification
is deterministic (explicit per quick action, keyword rules + `ANSWER`
fallback for free text), prompts separate system / user / untrusted
webpage data, and every response is checked against the trust policy
(request-id echo, closed field set, length caps, http/https-only sources)
before the UI may render it.

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
- **Command pipeline (Phase 3)** — command creation, quick actions with
  explicit intents, deterministic free-text classification, empty/overlong
  commands, no-content failures (`AI_PAGE_UNAVAILABLE`), failing handlers,
  AI error mapping with retryability, supersede/cancellation semantics.
- **UI** — Side Panel (including the on-demand Page Insight capture:
  stats, expandable preview, developer JSON, site-access guidance,
  unsupported-page and idle states), Popup, and Command Center rendering,
  command input (Enter / Shift+Enter / disabled / loading / clear),
  quick actions, loading/error/success states, settings (theme + reduce
  motion applied to the document), first-run tip.
- **Security** — malformed message rejection, unsafe URL handling,
  invalid stored data, error sanitization (no stack traces leak).
- **AI reasoning engine (Phase 3)** — deterministic intent resolution,
  per-intent context minimization (forms never sent), prompt 3-layer
  separation and delimiter-injection defense, JSON-only parsing (no eval),
  response trust policy (request-id echo, closed field set, budget caps,
  http/https-only sources, unknown-field rejection), gateway contract and
  HTTP error mapping (transport-agnostic fetcher), client timeout /
  cancellation, safe-Markdown rendering (no HTML execution, no
  `javascript:` links, node cap), and hostile-page end-to-end scenarios.

- **Workflow engine (Phase 5)** — deterministic task understanding
  (clause splitting outside quotes, bounded clauses, code/approval-forgery
  refusals, context minimization), the closed state machine (no path to
  `RUNNING` without approval, no outgoing edges from terminal states),
  validation (closed/forbidden keys, unregistered actions, step bounds,
  hash tampering, sensitive-field blocking, risk propagation without
  downgrade), planning (reference resolution, ambiguity refusal, evidence
  requirements, proposal acceptance/rejection), the session store
  (single-use approval, one workflow per tab, TTL expiry, bounded
  transcript, UI projection), the orchestrator (approval gates, stop
  conditions, bounded retries, pause/resume/cancel, honest `PARTIAL`),
  bounded observation and per-step/final verification, replanning (new
  approval always required), concurrency and run budgets, adversarial
  inputs (page content is data, replay protection, execution ceilings),
  the background message surface (typed payload validation, idempotency,
  tab-change staleness, no persistence), and the Side Panel workflow UI
  (preview → approve → verified result, plus the Settings safety section).

`npm run smoke` additionally loads the *built* `dist/background.js` **and**
the *built* `dist/content.js` (the latter into a jsdom web-page fixture
that includes prompt-injection content) with a chrome shim and exercises
real end-to-end round-trips: extraction, reasoning commands and quick
actions (validated AI responses with echoing request ids, http/https-only
sources, no executable payloads), removed-action rejection, the form-value
guarantees on the production bundles, and the full Phase 5 workflow path
(create → validate → preview → approve → execute → observe → verify →
complete) plus wrong-hash, cancelled, stale-tab, sensitive-field,
duplicate-approval, malformed-payload, and no-storage-write checks.

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
  Provider secrets (when a real provider is used) live only in the
  Secure Gateway, never in the extension.
- **Untrusted inputs on both sides (Phase 3):** webpage content is
  untrusted data inside prompts (delimited, labeled, delimiter-escape
  neutralized), and AI output is untrusted too (parsed as JSON only,
  validated against a closed trust policy before rendering; Markdown is
  rendered as React text nodes — no HTML execution).
- **Honest states:** reasoning failures surface as typed, user-safe
  errors; page context exposes all seven states — Not requested /
  Capturing / Ready / Partial / Unsupported / Permission required /
  Unavailable.

---

## Current limitations (Phase 5)

- **Actions are bounded and explicit.** Only the six typed actions in the
  allowlist exist; every plan and every workflow needs your approval, and
  there is no bulk/always-allow mode, no autonomous replanning, and no
  background automation.
- **Workflows are short and shallow.** At most 4 steps of one action each,
  planned from the current page only. There is no branching, no looping,
  no cross-tab or multi-page work, and no dependency graph — a workflow is
  a linear, reviewable task, not an agent plan. Goals the deterministic
  planner cannot ground in the captured page are refused
  (`WORKFLOW_TARGET_NOT_FOUND` / `WORKFLOW_TARGET_AMBIGUOUS`) instead of
  guessed, and mixed phrasing falls back to the Phase 4 single-action
  behaviour or to reasoning.
- **Action phrasing is pattern-based.** The deterministic planner
  understands explicit phrasings like `find "pricing"`, `scroll down`,
  `click the "Save" button`, `type "Mumbai" into the "City" field`,
  `select "India" in the "Country" dropdown`, `read this page`. Free-form
  action requests fall through to reasoning instead.

- **Default reasoning is the built-in local mock provider.** It is fully
  functional and deterministic (summaries/analyses/explanations grounded
  in the captured page structure), but it is not a large language model.
  Real-model reasoning requires deploying the Secure Gateway
  (`POST /v1/reason`) and setting `VITE_AI_GATEWAY_URL`; no provider
  secret ever ships in the extension.
- **Research and Compare are not implemented.** The Phase 1 quick actions
  by those names were removed from the UI instead of being faked:
  multi-page research and cross-tab comparison need capabilities that do
  not exist yet, and they are listed in the roadmap.
- Reasoning is **single-page and on-demand** — no web crawling, no
  link-following, no cross-tab context.
- The Command Center transcript is **session-only by design** — there is
  no conversation persistence or long-term memory.
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

- **Phase 3 (delivered):** real AI reasoning over page context —
  intent resolution, per-intent context building, injection-defended
  prompts, validated responses, and the Secure Gateway contract for
  secret-free provider connectivity.
- **Phase 4 (delivered):** the Safe Action Engine — typed, bounded
  browser actions with preview → permission → execute → verify, plan-hash
  binding, single-use expiring approvals, freshness checks, sensitive-
  field blocking, and stop-on-failure execution.
- **Phase 5 (delivered):** the Contextual Workflow Engine — deterministic
  task understanding, bounded multi-step plans, hash-bound single-use
  approvals, step-by-step execution through the Action Engine, checkpoint
  observation, per-step verification, honest partial outcomes, bounded
  retries and one bounded replan, pause/resume/cancel, and session-only
  state.
- **Future candidates (not started):** multi-page research and
  cross-tab comparison (Research/Compare were deliberately removed from
  the UI rather than mocked), a wider typed action vocabulary,
  integrations through the integration registry, and session continuity.
  Anything that executes stays bound to the same safety pipeline:
  preview, explicit permission, bounded execution, verification.

Each phase builds on the abstractions established here — no rewrites of
the UI, messaging, storage, pipeline, or page-intelligence contracts are
anticipated.

---

## License

Internal project — no license distributed.
