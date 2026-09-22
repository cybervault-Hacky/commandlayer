# CommandLayer — Safe Action Engine (Phase 4)

Architecture and security model for bounded, permission-gated browser
actions.

> **Core invariant:** `PREVIEW → PERMISSION → EXECUTE → VERIFY`. No
> action may bypass any stage. **CommandLayer never gives the AI
> unrestricted browser control. Every executable action must pass typed
> validation, permission checks, context validation, and bounded
> execution.**

## 1. Pipeline overview

```
User command
   │
   ▼
COMMAND_SUBMIT (typed envelope, sender-checked)
   │
   ▼
looksLikeActionRequest? ── no ──▶ AI reasoning engine (Phase 3)
   │ yes                                   (never executes anything)
   ▼
Deterministic planner (keyword rules + quoted targets)
   │
   ▼
Strict validator (closed allowlist, closed fields, limits)
   │
   ▼
ActionPlan stored in background session store (state: AWAITING_PERMISSION)
   │
   ▼
Side Panel / Command Center renders the ACTION PREVIEW
   │
   ▼  (explicit "Allow & run" click — the ONLY approval path)
ACTION_EXECUTE { planId, planHash }
   │
   ▼
Executor gates: store lookup → hash binding → state check →
single-use approval consume → tab/URL freshness → content-hash
freshness (target actions) → state machine APPROVED → EXECUTING
   │
   ▼
Step loop: one validated step at a time over the typed wire protocol
(background → content script → DOM), STOP on first non-success
   │
   ▼
ActionExecutionResult (per-step status, boolean verification,
user-safe summary) → UI progress/verification card
```

## 2. Module map (`src/actions/`)

| Module | Responsibility |
| --- | --- |
| `types.ts` | Closed action union, targets, plans, step results, error codes, wire response type |
| `limits.ts` | `ACTION_LIMITS` — every hard bound in one place |
| `errors.ts` | Typed `ActionError` construction with the fixed user-safe vocabulary |
| `targets.ts` | Safe target model (text / role+name / stable-id), strict parsing, closed role list |
| `sensitive.ts` | Conservative sensitive-field classifier (type / autocomplete / keywords) |
| `validator.ts` | Trust boundary for action payloads: closed kinds, closed fields, caps |
| `planHash.ts` | Canonicalized, deterministic plan identity (FNV-1a over binding fields) |
| `registry.ts` | The allowlist: registered kinds, FIXED risk levels, preview wording |
| `permissions.ts` | Single-use, time-boxed, hash-bound approvals (in-memory ledger) |
| `machine.ts` | Explicit state machine; invalid transitions rejected |
| `planner.ts` | Deterministic natural-language → validated plan (no AI involved) |
| `protocol.ts` | Background ↔ content wire types + structural guards (both directions) |
| `session.ts` | Bounded in-memory plan store (worker lifetime = session) |
| `executor.ts` | The ONLY code path that runs actions; all privileged access injected |
| `runtime.ts` | Content-side step execution against the live DOM (bounded, realm-safe) |

Supporting pieces elsewhere:

- `src/background/actionSession.ts` — privileged executor environment
  (tabs API, content channel, page capture) plus `executeApprovedPlan`
  and `cancelPlan` entry points used by the message handlers.
- `src/content/contentScript.ts` — routes the two request kinds
  (extraction + action step); everything else is ignored silently.
- `src/shared/components/ActionPreviewCard.tsx` /
  `ActionProgressCard.tsx` — preview and execution/verification UI.

## 3. Action allowlist and risk

The registry owns the allowlist and the risk mapping. Risk is never
derived from AI output, request payloads, or settings.

| Kind | Risk | Executes in |
| --- | --- | --- |
| `READ_PAGE` | `READ_ONLY` | Background, via Phase 2 PageContext |
| `FIND_TEXT` | `READ_ONLY` | Content script (read-only DOM scan) |
| `SCROLL` | `LOW_RISK` | Content script (bounded `scrollTo`) |
| `CLICK_ELEMENT` | `CONFIRMATION_REQUIRED` | Content script (revalidate + click + verify) |
| `TYPE_TEXT` | `CONFIRMATION_REQUIRED` | Content script (sensitive gate first) |
| `SELECT_OPTION` | `CONFIRMATION_REQUIRED` | Content script (match option by label) |

Anything not registered is refused at three independent layers
(validator, wire protocol, executor registry gate).

## 4. Targeting model

`ElementTarget` has exactly three kinds:

- `text` — visible text (or accessible name for form fields)
- `role` — closed ARIA role list + accessible name
- `stable-id` — strict identifier pattern `^[A-Za-z][A-Za-z0-9_-]{0,127}$`

There is no CSS/XPath selector kind and no coordinate targeting. The
content-side resolver scans a bounded candidate set (interactive
elements, capped at `TARGET_MAX_CANDIDATES_SCANNED`) and treats
occurrence mismatches as ambiguity errors rather than guessing. DOM
checks are structural (`tagName` / `nodeType`) — not constructor
identity — so isolated-world content execution stays robust.

## 5. Permission model

1. **Explicit.** Only `ACTION_EXECUTE` (driven by the Allow & run button)
   grants permission. Free text like "yes" or "do it" routes to the
   planner/reasoning and never grants anything.
2. **Single-use.** `permissionLedger.consume` marks the approval
   consumed; a second execution attempt is denied.
3. **Time-boxed.** Approvals expire after `PLAN_TTL_MS` (120 s).
4. **Hash-bound.** The consumed approval must match the executed plan's
   hash; any discrepancy yields `ACTION_PLAN_CHANGED`.
5. **In-memory.** Nothing persists; worker restart clears everything.
6. **No global allow.** There is no `ALLOW_ALL_ACTIONS` permission and
   no setting that disables confirmations.

## 6. Plan binding and freshness

`computePlanHash` canonicalizes the plan's binding fields — the action
payloads, `tabId`, `url`, and the captured `contentHash` — and hashes
them with FNV-1a. The executor verifies both
`claimedHash === storedPlan.planHash` and
`computePlanHash(storedPlan) === storedPlan.planHash`, so neither a
forged request nor a tampered stored plan can execute.

Freshness before execution:

- active tab id and URL must equal planning-time values;
- for plans containing target actions, the minimal content hash
  (`metadata + headings + text` profile) must still match.

Failures map to `ACTION_CONTEXT_STALE`; the plan is disposed.

## 7. Execution semantics

- Steps run strictly in order, one message per step, through
  `EXECUTE_ACTION_REQUEST_TYPE` (`cl:execute-action-request`, v1).
- The content script **re-validates every request** before touching the
  DOM (defense in depth — the wire validator already rejected unknown
  keys, executable-content keys, and selector-shaped targets).
- Any non-success step (`failed`, `blocked`, `stale`, `cancelled`)
  **stops the run**; remaining steps are never attempted.
  `MAX_REPLANS = 0`: there is no autonomous retry or replan. The user
  decides the next move.
- Verification is boolean/state only. `TYPE_TEXT` compares expected vs
  actual and reports `{ ok: boolean }` — values are never returned.
- Results are disposed single-use: after the one authorized execution
  (or a terminal pre-check failure) the plan leaves the store.

## 8. Sensitive-field policy

Before any `TYPE_TEXT`, the runtime classifies the target field:

- input `type="password"` → always sensitive;
- `autocomplete` tokens (`current-password`, `cc-*`, `one-time-code`,
  transaction tokens, …) → sensitive;
- descriptor keywords over id/name/label/placeholder/aria-label
  (password, credit card, cvv, otp, 2fa, bank, iban, private key, api
  key, secret, token, ssn, pin, …) → sensitive.

The classifier is deliberately conservative: **uncertainty blocks**.
Blocked steps return the fixed user-safe message, leave the field
untouched, and the executor marks the whole plan `blocked`. Typed
values never appear in responses, logs, summaries, or results.

## 9. State machine

```
IDLE → PLANNING → PREVIEW → AWAITING_PERMISSION → APPROVED →
EXECUTING → VERIFYING → COMPLETED
(any active state → CANCELLED / FAILED / BLOCKED / STALE)
```

`transition()` rejects anything outside the table; in particular there
is **no edge from PLANNING or PREVIEW to EXECUTING** — AI output can
never reach execution directly.

## 10. Wire protocol

Background → content: `{ v: 1, type: 'cl:execute-action-request',
stepId, planId, action }`. The structural guard rejects wrong versions,
unknown kinds, unknown target kinds, unknown target keys, and any
executable-content key (`javascript`, `script`, `code`, `eval`,
`selector`, `xpath`, `command`, `html`).

Content → background: `{ ok: true, result: { status, message,
verification?, data? } } | { ok: false, error }`, re-parsed
structurally before the executor trusts any of it.

## 11. UI model

- **ActionPreviewCard** — steps, targets, values the user asked to
  type, fixed risk badge, `[Cancel]` / `[Allow & run]`. Focus lands on
  the approve button; `Escape` cancels; Tab is trapped between the two
  decisions while pending.
- **ActionProgressCard** — ✓ done · ● running · ○ pending, per-step
  verification lines (boolean/state only), bounded read-only result data
  (find matches, page summary), and the user-safe run summary.
- **Settings → Actions & safety** — informational only; there is no
  switch that weakens the safety model.
- Command Center transcripts show plans and executions inline,
  session-only; read-only previews carry no buttons.

## 12. Observability

Safe logging only: action kind, step/plan identifiers, status, and
duration. Typed text, field values, page content, and secrets are never
logged or included in results.

## 13. Threat model highlights

| Threat | Defense |
| --- | --- |
| AI output driving execution | No `actions` field survives AI validation (closed contract); plans only from the deterministic planner; executor reads only from the session store |
| Forged/tampered plans | planHash binding both ways; unknown plan ids refused |
| Approval replay | Single-use consumed approvals; disposed plans |
| Stale approval abuse | TTL expiry enforced in `consume` |
| Page changed under a pending plan | Tab/URL/content-hash freshness re-checks before execution |
| Injection via payloads | Closed field sets at validator AND wire guard; executable-content keys rejected |
| Selector smuggling | No selector target kind; unknown target keys rejected; stable-id regex |
| Sensitive data entry | Mandatory pre-type classifier; block on uncertainty; values never echoed |
| Hostile page stalling execution | Bounded candidate scans, capped matches, per-step budget, stop-on-failure |
| Cross-realm constructor tricks | Structural `tagName`/`nodeType` checks instead of `instanceof` |
