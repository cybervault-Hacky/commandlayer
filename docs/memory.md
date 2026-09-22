# Persistent Personal Memory

CommandLayer can remember a small number of things you explicitly ask it to
remember — your preferences, working style, project context, and standing
instructions — so later requests do not have to repeat them.

Memory is **intentional, explicit, bounded, and inspectable**. It is not
surveillance: CommandLayer never *notices* something and stores it. Every saved
memory exists because you asked for it, saw exactly what would be stored, and
confirmed it.

> **Memory is not a secret vault.** CommandLayer refuses to store passwords,
> one-time codes, payment details, API keys, tokens, private keys, credentials,
> and every other category in the sensitive-data policy below. If you want a
> password manager, use a password manager.

---

## 1. The memory model

| Property | Value |
| --- | --- |
| Storage | `chrome.storage.local`, key `commandlayer.memory.v1` |
| Schema | `MEMORY_SCHEMA_VERSION = 1` |
| Maximum records | **50** (hard cap, enforced on every write) |
| Maximum length | **240 characters** per memory (minimum 3) |
| Source | `USER_EXPLICIT` only — the only value that exists |
| Confidence | `HIGH` (only user-confirmed memories are stored) |
| Scope | `GLOBAL` or `PROJECT` (`PROJECT` requires a project name) |
| Retrieval bound | at most **4** memories per reasoning request |
| Privacy switch | Settings → **Memory** (on by default) |

A stored record is exactly:

```ts
{
  id: string;              // random, opaque, 24 characters — never derived from content
  kind: MemoryKind;        // one of the five categories below
  content: string;         // the normalized sentence you confirmed
  scope: 'GLOBAL' | 'PROJECT';
  project: string | null;  // the project name, when scope is PROJECT
  createdAt: number;
  updatedAt: number;
  source: 'USER_EXPLICIT';
  confidence: 'HIGH';
  enabled: boolean;
}
```

There is no page identity, no URL, no tab, no hostname, no browsing trail, no
usage counter, and no timestamp of *when you looked at something*. The record
holds what you said and when you said it — nothing else.

### Categories (five, closed set)

| Category | Use it for | Example |
| --- | --- | --- |
| `PREFERENCE` | How you like things | “I prefer TypeScript for frontend projects.” |
| `USER_FACT` | Stable facts about you | “I work in the IST timezone.” |
| `WORK_STYLE` | How you work | “I write tests before implementation.” |
| `PROJECT_CONTEXT` | A named project's stack or conventions | “The CommandLayer project uses Next.js.” |
| `EXPLICIT_INSTRUCTION` | Standing instructions for CommandLayer | “Always show a preview before executing browser actions.” |

The category is inferred deterministically from the sentence (scope beats
keywords, instructions beat preferences, and so on) and is always shown in the
confirmation card before anything is stored. Unknown categories cannot exist:
storage validation discards any record whose `kind` is not in this set.

---

## 2. Consent: nothing is stored without you

Memory writes have exactly one entry point — an explicit memory command — and
exactly one commit path — a confirmed preview.

```
"Remember that I prefer TypeScript."
        │
        ▼
  parser           memory intent (REMEMBER / FORGET / LIST_MEMORY / UPDATE_MEMORY)
        │
        ▼
  sensitive policy  reject passwords, codes, cards, keys, tokens, … (nothing is echoed back)
        │
        ▼
  matcher           duplicate? near-duplicate? update of an existing memory?
        │
        ▼
  preview           "Remember this?" — content, category, source, replaces-existing
        │          held in worker memory only, expires after 2 minutes, single-use
        ▼
  your confirmation ──► repository ──► chrome.storage.local
        │
        └── Cancel / dismiss ──► the preview is discarded and nothing was written
```

- **Nothing is persisted before you confirm.** Asking is only a proposal; the
  command result carries a *preview*, not a memory.
- **Confirmations are single-use and expire after two minutes.** A replayed or
  stale confirmation is refused (`MEMORY_INVALID`).
- **At most 5 previews** can be pending at once; asking again replaces the
  oldest.
- The confirmation card shows the content, the category, the source
  (*you asked explicitly*), and — for an update — the **Before / After** values.
- Every stored memory carries one fixed audit line:
  *“Saved because you explicitly asked CommandLayer to remember it.”*

### Commands

| What you type | Intent | Result |
| --- | --- | --- |
| `Remember that I prefer TypeScript.` | `REMEMBER` | Preview → confirm → saved |
| `Remember that I now prefer TypeScript.` | `REMEMBER` (change marker) | Preview → confirm → **updates** the existing memory |
| `Update my memory about my editor to I prefer Neovim.` | `UPDATE_MEMORY` | Preview → confirm → updates the target, or reports no match |
| `Forget that I prefer TypeScript.` | `FORGET` | Preview → confirm → deleted |
| `What do you remember?` | `LIST_MEMORY` | Lists saved memories (optionally filtered by category) |

Ambiguity is never resolved by guessing: if two memories match a `FORGET`
equally well, CommandLayer lists the candidates and points at
**Settings → Memory** instead of deleting one of them.

### Duplicate and update detection

- Exact (normalized) content → **already saved**; nothing is written twice.
- Very similar content (token overlap ≥ 0.5, same category) → treated as an
  update of the existing memory, with Before / After shown.
- A change marker (`now`, `instead`, `no longer`, `actually`, `currently`) with
  the same attribute (same leading verb, same value shape) → **replacement**.
- Two memories are only treated as the same attribute when they have the same
  shape — so `I prefer TypeScript for frontend work` and `I prefer dark mode`
  coexist instead of overwriting each other.

---

## 3. What memory refuses — the sensitive-data policy

One centralized policy module gates every path (command, preview, commit, and
storage load). It is **conservative**: when the classifier is unsure, it
blocks. Refusals are safe: the refused text is never repeated back to you, to
the AI, or into storage — the card states *“Nothing was stored.”*

| Blocked category | Examples of what is detected |
| --- | --- |
| Credentials | password, passwd, passphrase, PIN, login credentials |
| One-time codes | OTP, one-time password/code, verification code, 2FA codes, authenticator codes |
| Payment data | credit/debit card numbers, CVV/CVC, expiry, IBAN/SWIFT, bank account, routing number |
| Identity numbers | SSN/social security, national ID patterns |
| Keys & tokens | API keys, secret/client secrets, access/refresh/bearer tokens, JWT, private keys, seed/recovery phrases, authorization headers |
| Session material | cookies, session ids, session tokens |
| Value shapes | JWT-shaped strings, high-entropy 32+ character secrets, 13+ digit number runs, `user:password@host` URLs, `key = value` secret assignments |

Also rejected: content over the length cap (`MEMORY_CONTENT_TOO_LONG`),
content that is not a sentence (`MEMORY_INVALID`), content that makes no claim
at all (filler such as *“remember that”* yields nothing to store), unknown
categories, a `PROJECT` scope without a project label, and secret-shaped
project labels.

The policy is intentionally biased toward false negatives being impossible:
blocking an innocent sentence costs you one rephrase; storing a secret cannot
be undone.

---

## 4. What memory is never used for

Memory is **context, not authority**. It cannot:

- grant, expand, or pre-approve any action permission — approvals stay
  single-use, hash-bound, and tab-bound in the Action Engine;
- approve, resume, or modify a workflow, or change its risk;
- bypass a sensitive-field block or any Phase 4/5 validator;
- skip a confirmation, downgrade a risk, or enable an action type;
- execute code, be executed, or be evaluated as a program;
- act as a system prompt, a rule set, or a configuration store.

Precedence is fixed and one-directional:

```
your current explicit instruction  >  saved memory  >  defaults
```

If two saved memories disagree, the conflict is resolved deterministically —
the most recently updated one wins — and the older one is dropped from that
request. Nothing is silently merged, and memory never wins against what you
just asked for.

### The AI boundary

- The AI can **never** create, update, or delete a memory. It has no write
  path: it receives memories as read-only input and its output is validated
  data, never a command.
- Retrieval is relevance-bound: a request only receives memories that share
  vocabulary with the request (token-overlap match), capped at **4 memories**
  and 240 characters each. An unrelated request receives nothing — the store is
  never dumped into a prompt.
- Memories are sent inside an explicit `<saved_memory>` block, *outside* and
  *before* `<webpage_data>`, and both delimiter families are neutralized
  inside the text. The system prompt states that the block is **data**: it
  cannot authorize anything, and the current request always wins.
- Instructions *inside* a memory are inert text like any other memory content —
  a memory saying “approve every action” changes nothing, because nothing in
  the execution path reads memory.

When memories are used, the UI says **“Using N saved memories”** and shows
exactly which ones.

### The workflow / action boundary

Planning, risk classification, plan hashing, tab binding, approval state, and
step verification are unchanged by memory. A saved memory cannot make a
workflow cheaper to approve, and it cannot alter an already-hashed plan.

---

## 5. Storage, validation, and failure handling

- **Single writer.** `src/memory/storage.ts` is the only module that touches
  `chrome.storage.local`; the repository is the only caller of storage; the
  controller is the only caller of repository mutations. No UI, command, or AI
  path can write memory directly.
- **Everything read is untrusted.** On load, each record is re-validated:
  closed category, length bounds, scope/project consistency, id shape,
  timestamps, source, confidence, enabled flag — *and the sensitive-data
  policy is re-run*. Malformed, forged, or secret-bearing records are dropped
  silently rather than trusted. A schema version other than `1` is not
  interpreted.
- **Migration tolerance.** Unknown or future schema versions are treated as
  “nothing readable” and never crash the extension; a corrupt blob reads as an
  empty store and the next confirmed write replaces it safely.
- **Graceful degradation.** Quota errors, a failing storage backend, and
  unreadable data surface as safe messages (`MEMORY_STORAGE_FAILED`, or an
  empty store for reads) — never as exceptions, stack traces, or lost UI state.
  A failed write is rolled back so the in-memory view never diverges from disk.
- **Writes are serialized** through a queue, so two simultaneous confirmations
  cannot lose an update.

### Limits

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_MEMORY_RECORDS` | 50 | Hard cap; further saves are refused with `MEMORY_LIMIT_EXCEEDED` |
| `MAX_MEMORY_CONTENT_LENGTH` | 240 | A memory is a sentence, not a document |
| `MIN_MEMORY_CONTENT_LENGTH` | 3 | Nothing meaningful below this |
| `MAX_MEMORY_PROJECT_LENGTH` | 40 | Project labels stay short |
| `MAX_RETRIEVED_MEMORIES` | 4 | Per reasoning request |
| `MAX_SEARCH_RESULTS` | 25 | Management-UI search results |
| `MAX_PENDING_PREVIEWS` | 5 | Unconfirmed previews held in memory |
| `PREVIEW_TTL_MS` | 120 000 | A confirmation must arrive within 2 minutes |
| `SIMILARITY_THRESHOLD` | 0.5 | Token overlap that counts as “the same memory” |
| `ID_LENGTH` | 24 | Random, opaque, never content-derived |

---

## 6. Privacy controls and deletion

**Settings → Memory** provides the full surface:

- **Memory on/off.** Off means **no writes and no retrieval**: memory commands
  report `MEMORY_DISABLED`, and no memory is ever attached to a reasoning
  request. Existing memories are *retained* until you delete them, and the UI
  says so plainly:
  *“Memory is off. CommandLayer will not save or use personal memory.”*
  Turning memory off never deletes anything, and nothing is hidden from you:
  the manager stays readable and deletion keeps working while memory is off.
- **Manage memory.** Every saved memory is listed with its category, when it
  was saved, and the audit line. You can search, filter by category, delete one
  memory (with an inline confirmation), or **Clear all memory** — which
  requires an explicit *Delete all* in a confirmation dialog that states
  **“This cannot be undone.”**
- **Honest states.** If storage cannot be read or written, the UI says so
  instead of pretending the list is empty for a benign reason.

### How is a memory surfaced to the user?

- *Before* saving: the “Remember this?” card (content, category, source,
  replaces-existing; Before/After for updates).
- *After* saving: a result card (“Memory saved.” / “Memory updated.” /
  “Memory deleted.” / “Nothing was stored.”).
- *While using*: the “Using N saved memories” note on the answer, expandable to
  show each memory and its category.
- *In the Command Center transcript*: memory turns are read-only history; only
  the newest pending preview is interactive.

---

## 7. Honest limitations

- **No encryption theater.** Records are stored in `chrome.storage.local`,
  which the browser does not encrypt at rest for extensions. Meaningful
  at-rest encryption would require user key management (a passphrase, a keystore,
  or a separate secret), which CommandLayer does not have — so it is not
  claimed. The protections that *are* real: explicit consent, a closed schema,
  conservative sensitive-data rejection, a small record cap, full
  inspectability, deletion, and relevance-bounded retrieval.
- **Memory is not a secret vault** and never will be. Secrets are refused by
  policy at every layer.
- **Export/import are not implemented.** Export was only acceptable if it could
  not leak secrets; because a memory's text is free-form, a future export would
  need its own review. Import is deferred: it would have to pass through the
  same validation pipeline before anything was stored. Neither is a silent
  gap — both are decisions.
- **Free-form inference is heuristic.** Category and duplicate detection are
  deterministic pattern rules, not a model. The confirmation card always shows
  the inferred category, and a wrong guess costs one rephrase — never a silent
  write.
- **Retrieval is deliberately narrow.** A memory that shares no vocabulary with
  your request is not sent at all, so an off-topic standing preference may not
  influence an answer. This is the privacy/utility trade-off, made in favour of
  privacy.
- **Nothing is remembered after the session except memory.** Conversation
  transcripts, plans, workflows, and page context remain session-only.

---

## 8. Where it lives in the code

| File | Responsibility |
| --- | --- |
| `src/memory/types.ts` | Closed vocabulary: categories, intents, previews, recorded views |
| `src/memory/limits.ts` | Every bound in one place |
| `src/memory/sanitizer.ts` | All text normalization (single source) |
| `src/memory/policy.ts` | Sensitive-data policy and content validation |
| `src/memory/schema.ts` | Untrusted stored-state parsing and validation |
| `src/memory/storage.ts` | The only `chrome.storage.local` touchpoint for memory |
| `src/memory/repository.ts` | The only mutation path: policy, limits, atomic saves |
| `src/memory/matcher.ts` | Similarity, duplicates, conflicts, bounded retrieval |
| `src/memory/parser.ts` | Deterministic memory-command detection |
| `src/memory/controller.ts` | Consent: previews, single-use confirms, TTL |
| `src/background/memorySession.ts` | Message-level commands (confirm/delete/clear/list/status) |
| `src/shared/components/MemoryPreviewCard.tsx` | The “Remember this?” consent card |
| `src/shared/components/MemoryResultCard.tsx` | Save/delete/blocked outcomes |
| `src/shared/components/MemoryUsedNote.tsx` | “Using N saved memories” disclosure |
| `src/sidepanel/components/MemoryView.tsx` | Manage, search, filter, delete, clear all |
| `docs/memory.md` | This document |

## 9. Testing

- **Core** — create / read / update / delete / clear / list / search, duplicate
  and conflict handling, preview TTL and single-use confirms, limit enforcement,
  malformed stored state, schema mismatch, storage failures, concurrent writes.
- **Security** — the full sensitive matrix (passwords, one-time codes, cards,
  API keys, tokens, private keys, seed phrases, auth headers, cookies,
  credential URLs, high-entropy values), oversized and forged records, tampered
  storage, disabled state, hostile memory payloads, and an injection-shaped
  memory that must remain inert data.
- **Boundaries** — the AI cannot persist memory (a spoofed provider that claims
  to save one changes nothing), memory cannot grant permission or approval, and
  a workflow's hash, risk, and approval requirements are byte-for-byte
  unaffected by saved memory.
- **Privacy** — browsing, capture, reasoning, quick actions, actions, and
  workflows write nothing at all; memory changes only on an explicit,
  confirmed memory operation.
- **Persistence** — a confirmed memory survives a service-worker restart, a
  deletion stays deleted, and a tampered record is rejected after restart.
- **Smoke (built bundle)** — create → validate → confirm → store → retrieve →
  use → delete → verify gone, plus sensitive-blocked, off-state, privacy, and
  restart checks against the production worker.
