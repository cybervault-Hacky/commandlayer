# CommandLayer — Phase 5 Workflow Engine

> **Scope.** This document describes the Contextual Workflow Engine added in
> Phase 5: how a multi-step browser goal becomes a bounded workflow, how that
> workflow is validated, previewed, approved, executed, observed, verified,
> and stopped. Phase 4 remains the **only execution security boundary**; the
> workflow layer adds planning, budgets, and honest reporting on top of it.

---

## 1. Goal → result in one picture

```
User Goal
   ↓  understanding.ts      deterministic, local, no model in the loop
Task Understanding           (kind, clauses, intents, context needs, outcome)
   ↓  planner.ts            deterministic, grounded in the captured page
Bounded Workflow Plan        (≤ MAX_WORKFLOW_STEPS steps, 1 action each)
   ↓  validator.ts          schema → registry → workflow validation
Step Preview                 (labels, risk, "Done when: …")
   ↓  approval              hash-bound, single-use, expiring
Execute Step                 → Phase 4 Action Engine (executePlan)
   ↓  observer.ts           one bounded snapshot at a checkpoint
Observe
   ↓  verifier.ts           registry-driven per-step condition
Verify
   ↘ Continue / Stop
Final Result                 (verified outcome, or an honest PARTIAL)
```

Nothing in this diagram loops: the number of steps, retries, observations,
replans, and the wall-clock lifetime are all fixed in `limits.ts`, and the
orchestrator asks its run guard for permission before every bounded action.

---

## 2. Data model (`src/workflows/types.ts`)

| Type | Meaning |
| --- | --- |
| `WorkflowStatus` | 14 closed statuses: `DRAFT`, `PREVIEW`, `AWAITING_APPROVAL`, `APPROVED`, `RUNNING`, `PAUSED`, `VERIFYING`, `COMPLETED`, `PARTIAL`, `FAILED`, `BLOCKED`, `CANCELLED`, `STALE`, `EXPIRED` |
| `WorkflowStepStatus` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`, `SKIPPED` |
| `WorkflowIntent` | `IDENTIFY`, `FIND`, `READ`, `OPEN`, `TYPE`, `SELECT`, `SCROLL` — the task-level verb, derived from the action kind, never supplied by content |
| `WorkflowOutcomeKind` | `NAVIGATION`, `CONTENT`, `READ_ONLY`, `INTERACTION` |
| `WorkflowOutcomeSpec` | Declared **before** approval: what "done" means, plus `expectedUrl` / `expectedText` when applicable |
| `WorkflowOutcome` | `{ kind, description, verified, detail }` — `verified` is true only after independent observation |
| `WorkflowStep` | `stepId`, `index`, `intent`, `label`, `actionPlan` (Phase 4), `actionsHash`, `retryPolicy`, `expectsNavigation`, `expectedUrl?`, `status`, `attempts`, `mutated`, `result?`, `detail?`, timestamps, `observedUrl?` |
| `Workflow` | `workflowId`, `requestId`, `goal`, `status`, ordered `steps`, `currentStepIndex`, `maxSteps`, propagated `risk`, `requiresConfirmation` (always `true`), `expectedOutcome`, page binding (`tabId`, `url`, `contentHash`), `workflowHash`, timestamps, `outcome?`, `summary?`, `revision`, `expiresAt`, `followUpWorkflowId?` |
| `WorkflowProposal` / `ProposedStep` | Untrusted input shape: `{ goal, steps: [{ action: unknown, label? }] }` |
| `WorkflowView` / `WorkflowStepView` / `WorkflowRunResult` | The UI-safe projections: identity, progress, bounded transcript, outcome — no plans, no page prose, no typed values |

Step wrappers are the important part: **one workflow step wraps exactly one
Phase 4 `ActionPlan`**, so a workflow can never batch hidden work, and every
step inherits the action engine's allowlist, targeting, risk, and
sensitive-field rules unchanged.

---

## 3. State machine (`src/workflows/machine.ts`)

```
DRAFT ──validate──► PREVIEW ──present──► AWAITING_APPROVAL ──approve──► APPROVED
                                                                        │ start
                                                                        ▼
   ┌────────────────────────────── pause ◄── RUNNING ──beginVerification──► VERIFYING
   │                                          │  ▲  resume                    │
   ▼                                          │  └────────────┐                │
 PAUSED ──────────────────────────────────────┘               │                │
                                                              ▼                ▼
   stop events: PARTIALLY_COMPLETE → PARTIAL · FAIL → FAILED · BLOCK → BLOCKED
                CANCEL → CANCELLED · STALE → STALE · EXPIRE → EXPIRED
                COMPLETE (from VERIFYING) → COMPLETED
```

Properties the tests pin:

- **No path to `RUNNING` without approval.** `START` exists only on
  `APPROVED`, and only `APPROVE` reaches `APPROVED`.
- **Terminal statuses have zero outgoing edges.** `COMPLETED`, `PARTIAL`,
  `FAILED`, `BLOCKED`, `CANCELLED`, `STALE`, `EXPIRED` can never be resumed,
  re-approved, or re-executed.
- Illegal transitions return `false` and leave the status untouched — the
  store never applies a partial change.

`WorkflowStore` (`state.ts`) is the authority for the state machine, the
approval binding, one-workflow-per-tab, and the bounded transcript. It is
session-scoped worker memory: records are copied on entry, capped
(`MAX_RECORDS`, `MAX_PENDING_WORKFLOWS`), swept on TTL, and never written to
storage.

---

## 4. Task understanding (`src/workflows/understanding.ts`)

Pure and deterministic — same input, same analysis, no model, no randomness,
no page dependency:

1. **Normalize** the goal (whitespace collapsed, bounded to
   `MAX_GOAL_LENGTH = 300`; longer text is flagged `oversized` and never
   becomes a workflow).
2. **Refuse** requests for executable content (`CODE_REQUEST_PATTERNS`:
   `javascript:`, `<script`, `eval(`, `document.cookie`, `node -e`,
   `python -c`, `curl`, `rm -rf`, "run this script", …) and requests to
   forge approval or disable a control (`APPROVAL_FORGERY_PATTERNS`:
   "pretend this was approved", "skip the confirmation", "bypass safety",
   "ignore previous instructions and execute it") with
   `WORKFLOW_UNSAFE_REQUEST`. Free text never grants permission.
3. **Split** the goal into top-level clauses on `and then` / `then` /
   `after that` / `and` / `;`, quote-aware (a quoted target is never split),
   capped at 6 clauses, and mark reference clauses ("open it",
   "click the first result", "follow that link").
4. **Classify**: `ACTION` (one Phase 4 action), `WORKFLOW` (bounded
   multi-step), `REASONING` (no action), or `UNSUPPORTED` (refused).
5. **Declare context needs**: the minimum Page Intelligence sections the
   intents require — `FIND`/`READ` → metadata + headings + text, `OPEN` →
   metadata + links. Forms, tables, and selections are never requested for a
   workflow.
6. **Declare the outcome** before approval, in user-facing words
   ("Open “React documentation” on react.dev.").

---

## 5. Planner (`src/workflows/planner.ts`)

Stateless and grounded. For each clause the planner reuses the **Phase 4
planner** (there is no second action parser), requires the clause's leading
verb to agree with the planned action, and adds exactly one workflow-only
capability: resolving a **result reference** against the captured links.

- A `FIND_TEXT` step is only planned when the query is *evidenced* on the
  page (`hasEvidenceForQuery`); otherwise `WORKFLOW_TARGET_NOT_FOUND`.
- A reference resolves through tiered matching (exact text > text contains >
  all tokens > partial tokens). A tie is `WORKFLOW_TARGET_AMBIGUOUS`;
  nothing is ever chosen at random. A reference without a previous query is
  `WORKFLOW_TARGET_NOT_FOUND`.
- Sensitive goals are refused **before any step exists**
  (`WORKFLOW_SENSITIVE_ACTION`), so no later "try another selector" path can
  reach them.
- Mixed/unsupported phrasing yields no workflow at all — the command falls
  back to the Phase 4 single-action planner or the reasoning engine, exactly
  as before.
- Risk is the propagated combined risk (`combinedWorkflowRisk`), and
  `requiresConfirmation` is always `true`.
- The workflow is stored as `DRAFT`; the store validates it into `PREVIEW`
  and presents it as `AWAITING_APPROVAL` through the state machine.

### AI proposals are hostile data

`planWorkflowWithProposal(proposal, input)` accepts a proposal **only** when
its action-kind sequence equals the deterministic plan's. A rejected
proposal never degrades safety: the deterministic plan (or a typed refusal)
is used instead, and the rejection is reported. AI output can therefore
never add a step, change a target, change risk, or introduce an action.

---

## 6. Validator (`src/workflows/validator.ts`)

The trust boundary for every workflow-shaped value:

1. **Schema validation** — closed field sets (`{goal, steps}`,
   `{action, label}`), exact types, bounded goal/label lengths, and a
   `FORBIDDEN_KEYS` blocklist that rejects executable smuggling shapes
   (`code`, `script`, `javascript`, `selector`, `xpath`, `css`, `eval`,
   `exec`, `command`, `shell`, `html`, `url`, `href`, `src`, `function`,
   `payload`).
2. **Action validation** — `parseActionCandidate` + the Phase 4 registry.
   Unknown kinds are refused here, which is what makes `EXECUTE_JAVASCRIPT`
   (or any other invented action) impossible.
3. **Workflow validation** — ≥ 2 steps, ≤ `MAX_WORKFLOW_STEPS`, exactly one
   action per step, `actionsHash` and `planHash` integrity, consistent tab
   binding, and sensitive-field propagation: if any step's target wording
   looks sensitive, the **whole workflow** is blocked
   (`WORKFLOW_SENSITIVE_ACTION`).
4. **Preview** — a `WorkflowView` with deterministic labels and risk. No
   plan, no page content, no reasoning.

The planner uses the same functions, so there is no privileged path.

---

## 7. Action Engine integration (`src/background/workflowSession.ts`)

The workflow engine never touches a page. The background layer supplies the
privileged seams:

| Seam | Implementation |
| --- | --- |
| `getActiveTab` | `chrome.tabs.query({active, currentWindow})` → `{ id, url }` (no titles, no history) |
| `capture(sections)` | one on-demand Phase 2 `getPageContext` (workflow sections: metadata, headings, text, links) |
| `authorizeStep(plan, workflowId)` | `actionSessionStore.addPlan(plan)` plus `permissionLedger.approveForWorkflow(plan.planId, plan.planHash, workflowId)` |
| `executeStep(planId, planHash)` | `executePlan(planId, planHash, createExecutorEnvironment())` |

Before each step the orchestrator **rebinds** the step's plan to the current
freshness fields (tab, URL, content digest) while proving the executable
actions are hash-identical to the approved step (`hashActions(...) ===
step.actionsHash`). Tampering stops the run as `BLOCKED` before execution.
The executor then re-checks everything itself: plan hash, single-use
approval, tab/URL/content freshness, allowlist, target resolution,
sensitive-field block, per-step bounds.

One workflow per tab at a time is enforced by the store
(`claimTab` / `releaseTab`, `WORKFLOW_CONFLICT`), so two workflows can never
drive one page.

---

## 8. Observation (`src/workflows/observer.ts`)

Observation happens **only at defined checkpoints**:

- before the first step (the page must still be the planned one),
- after a step that can change page state (`mutated`), and
- on the final verification pass.

There is no polling, no `MutationObserver`, no timer, no background
surveillance. `WorkflowObserver` performs exactly one capture per
checkpoint, converts it into a bounded `ObservationSample`
(`{ url, contentHash, title?, headings ≤ 8 }`), and returns `null` when the
page cannot be observed — which stops the run rather than continuing blind.
The run guard caps the total at `MAX_CONTEXT_REFRESHES = 8`; the refresh,
retry, replan, and deadline budgets are all consumed through it.

Navigation is detected deterministically (`detectNavigation`,
`urlMatchesExpectation` on origin + path only, so tracking parameters never
fake a failure) and an unexpected navigation stops the workflow
(`WORKFLOW_CONTEXT_CHANGED` → `STALE`). New tabs and popups are never
followed: the workflow is bound to its tab, and a different active tab stops
it (`WORKFLOW_TAB_CHANGED`).

---

## 9. Verification (`src/workflows/verifier.ts`)

Per-step verification is registry-driven and never inspects a value the user
typed:

| Action | Verified when |
| --- | --- |
| `READ_PAGE` | the page structure was read |
| `FIND_TEXT` | matches > 0 |
| `SCROLL` | the scroll completed |
| `CLICK_ELEMENT` | the target's in-page re-check passed |
| `TYPE_TEXT` / `SELECT_OPTION` | the field/option **state** matches (boolean/label only) |

`verifyWorkflowOutcome` then checks the declared outcome against the final
bounded observation: `NAVIGATION` requires the expected destination (or any
navigation when none was declared), `CONTENT` requires the expected text in
the title/headings or a `FIND_TEXT` step that matched, `READ_ONLY` /
`INTERACTION` require every step to have completed. Otherwise the workflow
ends `PARTIAL` with `verified: false` — **actions executed but outcome
unverified is never reported as success**.

---

## 10. Approval binding and hashing (`src/workflows/hash.ts`)

`computeWorkflowHash` canonicalizes (sorted keys, no whitespace — the same
canonicalization as the Phase 4 plan hash) and hashes:

- the goal,
- each step's identity: index, intent, `actionsHash`, `expectsNavigation`,
  `expectedUrl`,
- each step's executable actions,
- the propagated risk,
- the declared outcome,
- the page binding: `tabId`, `url`, `contentHash`.

Volatile runtime fields (status, attempts, results, observations) are
deliberately excluded: an approval stays valid while the plan is unchanged
and invalid the moment anything material changes.

`workflowHashMatches(workflow, claimed)` checks both the stored hash and a
fresh recomputation, so in-memory tampering is caught before the first step.
Approve, resume, and cancel are typed messages carrying identity only; the
UI never holds a plan.

---

## 11. Limits (`src/workflows/limits.ts`)

| Limit | Value | Why |
| --- | --- | --- |
| `MAX_WORKFLOW_STEPS` | 4 | a workflow is a short, reviewable task |
| `MAX_ACTIONS_PER_STEP` | 1 | no hidden batches |
| `STEP_TIMEOUT_MS` | 8 s | one step can never hang a run |
| `MAX_WORKFLOW_DURATION_MS` | 120 s | hard wall-clock budget per run |
| `MAX_STEP_RETRIES` | 1 | and only for retry-safe steps |
| `MAX_WORKFLOW_REPLANS` | 1 | a revision is a proposal, never a continuation |
| `MAX_CONTEXT_REFRESHES` | 8 | checkpoint observations only |
| `APPROVAL_TTL_MS` | 120 s | stale approvals cannot be replayed |
| `WORKFLOW_TTL_MS` | 300 s | session-scoped; nothing lives forever |
| `MAX_PENDING_WORKFLOWS` / `MAX_ACTIVE_WORKFLOWS` | 5 / 8 | bounded store |
| `MAX_RUNNING_PER_TAB` | 1 | no interference |
| `MAX_EVENTS` | 40 | the transcript is a ring, not a log |
| `MAX_GOAL_LENGTH` / `MAX_STEP_LABEL` / `MAX_OUTCOME_DESCRIPTION` | 300 / 96 / 200 | bounded user-facing text |
| `OBSERVATION_SECTIONS` / `REPLAN_SECTIONS` | metadata+headings+text / +links | minimum necessary capture |

There is no runtime override and no settings switch that can widen any of
these.

---

## 12. Failure model

| Situation | Result |
| --- | --- |
| Step fails (or its verification fails) | step `FAILED`, workflow `PARTIAL` if something completed, else `FAILED`; later steps never run |
| Step blocked by the action engine | step `BLOCKED`, workflow `BLOCKED` (never retried) |
| Tab changed / new tab active | `WORKFLOW_TAB_CHANGED` → `STALE`, nothing executes |
| Page changed before a step | `WORKFLOW_CONTEXT_CHANGED` → `STALE` |
| Expected navigation did not happen, or landed elsewhere | `STALE` with an explanatory summary |
| Run budget exhausted | `EXPIRED` at the next checkpoint |
| Approval TTL elapsed | `WORKFLOW_APPROVAL_EXPIRED`, workflow `EXPIRED`, nothing runs |
| User cancels | `CANCELLED`; a finishing in-flight step may complete, no future step starts |
| Actions ran, outcome unverified | `PARTIAL`, `verified: false`, explicit detail |
| Bounded replan possible | a **new** workflow in `AWAITING_APPROVAL` with a new hash and completed steps carried over as `SKIPPED` |

Summaries are user-safe sentences (e.g. "Step failed. Nothing after it ran
(1 of 2 steps completed).") — never stack traces, page prose, or typed
values.

---

## 13. Concurrency and idempotency

- **One workflow per tab**: `claimTab` reports a typed conflict
  (`WORKFLOW_CONFLICT`) instead of letting two workflows interleave; the tab
  is released when the run becomes terminal or is cancelled.
- **Single-use approval**: the stored approval hash is cleared on use; a
  duplicate approve is refused (`WORKFLOW_ALREADY_COMPLETED` once the run has
  finished, `WORKFLOW_STATE_INVALID` while it is live).
- **Cooperative controls**: pause and cancel set flags checked between
  steps, so a duplicate control message cannot corrupt a run mid-step.
- **Bounded execution**: the run guard's counters make "steps + retries"
  the hard ceiling of anything a single approval can ever execute, even if a
  replanner keeps proposing revisions.

---

## 14. Privacy

- Workflow state is **worker memory only**: no `chrome.storage` writes, no
  history, no profiling, no permanent task memory. Terminal records are
  evicted and expired records are swept.
- Observations capture the minimum (`metadata`, `headings`, `text`, and
  `links` only for a replan), and `ObservationSample` cannot carry
  paragraphs, form values, or typed text.
- The bounded transcript contains step lifecycle lines and bounded messages
  — never page content, never typed values, never hidden reasoning.
- Sensitive-field steps block the whole workflow, and a sensitive value is
  never stored, logged, previewed, or returned.

---

## 15. Extension points

- **More actions**: add a Phase 4 registry entry; workflows pick it up
  automatically (intent, risk, retry policy, preview, verification).
- **Better planning**: extend `understanding.ts` (clause vocabulary) or
  `planner.ts` (grounded resolution). Both are pure functions with unit
  tests, and both must keep refusing rather than guessing.
- **A model-assisted planner**: pass a `proposalSource` to `WorkflowEngine`
  or call `createFromProposal`. The proposal is untrusted by construction:
  it can only confirm the deterministic plan.
- **Different verification**: extend `verifier.ts` per action kind. The rule
  is fixed — never read a value the user typed, never claim an unobserved
  success.
- **UI**: consume `WorkflowView` / `WorkflowRunResult` only. New surfaces
  must not require plans or page content, and must keep the "Step N of M"
  progress, the risk badge, and the honest partial wording.

---

## 16. Where the code lives

| Path | Responsibility |
| --- | --- |
| `src/workflows/types.ts` | models, statuses, intents, outcomes, views |
| `src/workflows/limits.ts` | every centralized bound |
| `src/workflows/errors.ts` | 29 typed, user-safe error codes |
| `src/workflows/hash.ts` | workflow identity and tamper detection |
| `src/workflows/machine.ts` | the closed transition table |
| `src/workflows/understanding.ts` | deterministic task understanding + refusals |
| `src/workflows/planner.ts` | bounded planning + proposal acceptance |
| `src/workflows/validator.ts` | schema / registry / workflow validation |
| `src/workflows/state.ts` | session store, approvals, transcript, views |
| `src/workflows/session.ts` | per-run budgets, pause/cancel flags |
| `src/workflows/observer.ts` | checkpoint observation primitives |
| `src/workflows/verifier.ts` | per-step and final verification |
| `src/workflows/replan.ts` | bounded, approval-required replanning |
| `src/workflows/orchestrator.ts` | the engine: the only loop that exists |
| `src/background/workflowSession.ts` | privileged wiring + command surface |
| `src/shared/components/Workflow*Card.tsx` | preview and progress UI |
| `src/shared/hooks/useWorkflowController.ts` | identity-only UI controller |

Tests live in `src/workflows/__tests__/` (unit, validation, planning,
state, orchestration, concurrency, security, adversarial), plus the
background message surface (`src/background/__tests__/workflowSession.test.ts`)
and the Side Panel flow (`src/sidepanel/__tests__/workflowFlow.test.tsx`).
`npm run smoke` exercises the built bundles end to end.
