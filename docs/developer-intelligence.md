# Developer intelligence

Phase 7 adds a developer work layer to CommandLayer: understand code →
repository context → explain → inspect → plan → safely act → verify. It is
deliberately **not** an unrestricted coding agent. There is no code editing,
no committing, no pushing, no shell, and no autonomous loop.

## The chain

```
Page Intelligence (Phase 2)
        ↓  bounded, validated capture of the page the user is on
GitHub Context (Phase 7, src/github/)
        ↓  typed repository / file / diff / issue identity
Developer Intelligence (Phase 7, src/developer/)
        ↓  deterministic analysis + local search + change planning
AI Reasoning (Phase 3 + Phase 7 contract)
        ↓  validated prose, findings, and an advisory plan — never actions
Deterministic Planner (Phase 4 planner + Phase 7 navigation targets)
        ↓  typed steps, closed vocabulary, no AI-authored executable content
Phase 5 Workflow Engine (preview → approval → progress → verification)
        ↓  one approved step at a time, re-verified as it runs
Verification
```

Each arrow is a trust boundary: everything crossing it is re-validated on
the receiving side.

## The 12 intents

| Intent | What it answers | Where the data comes from |
| --- | --- | --- |
| `EXPLAIN_CODE` | What does this snippet/function/file body do? | Captured code slice |
| `EXPLAIN_FILE` | What is this file for, and how is it structured? | Code slice + path + language |
| `EXPLAIN_REPOSITORY` | What is this repository, how is it laid out? | README excerpt, file listing, language, visibility |
| `FIND_CODE` | Where is this symbol defined or used? | Bounded local search over captured content |
| `ANALYZE_DIFF` | What changed, grouped and classified? | Changed files, diffstat, diff excerpt |
| `REVIEW_PULL_REQUEST` | What is this PR doing, and what deserves attention? | PR description, changed files, diff excerpt |
| `ANALYZE_ISSUE` | What is being asked, and what would it involve? | Issue title/body, related captured files |
| `SUMMARIZE_COMMIT` | What did this commit change? | Changed files, diff excerpt, message |
| `COMPARE_CODE` | How do these two things differ? | Two captured slices, or the captured diff |
| `FIND_TODOS` | Where are the TODOs / FIXMEs / HACKs? | Bounded local scan of captured content |
| `FIND_POTENTIAL_BUGS` | What might be worth checking? | Captured code slice + diff excerpt + rules |
| `GENERATE_CHANGE_PLAN` | How would this be implemented safely? | Everything above + findings |

Intents are claimed only when the phrasing is clearly developer work, and the
developer path only engages when a validated GitHub context exists. Ordinary
page commands (`Summarize this page`, `find "…"`, `click "…"`, memory
phrasing) are untouched — tests assert each of those still resolves to its
Phase 1–6 behaviour on the same page.

## Deterministic first

A large part of every answer is computed locally, before any model runs:

- **Repository understanding** (`repository.ts`) — slug, ref, path, language,
  visibility, file count, config files, framework hints, README excerpt.
- **File understanding** (`file.ts`) — language, size in captured lines,
  probable purpose, notable structure.
- **Change understanding** (`diff.ts`) — changed files, additions/deletions,
  and a closed classification: `source`, `tests`, `configuration`,
  `documentation`, `dependency`, `assets`, `other`, plus the *sensitive*
  files worth extra attention (auth, session, token, secret, credential,
  payment…).
- **Review rules** (`review.ts`) — evidence-bound observations such as a
  hard-coded absolute URL, a weak hash function, disabled certificate
  verification, dynamic evaluation, an empty catch block, a test file that
  changed alongside its source, a very large change.
- **Issue understanding** (`issue.ts`) — requirements and acceptance criteria
  extracted from the issue body, related captured files.
- **Bounded local search** (`search.ts`) — the `FIND_CODE` path.
- **Change planning** (`plan.ts`) — ordered steps derived from findings,
  categories, issue criteria, and affected files.

Local findings are always produced, even when the model is unavailable, and
they always come with evidence. Deterministic findings are listed before
model-assisted ones and de-duplicate them.

## Findings: evidence, categories, and honesty

Every finding in a developer result has this shape (validated at the trust
boundary — `src/developer/validator.ts` and `src/ai/validator.ts`):

```ts
{
  severity: 'info' | 'low' | 'medium' | 'high',
  category: 'correctness' | 'maintainability' | 'security' | 'performance'
          | 'testing' | 'compatibility' | 'configuration',
  file: string | null,      // repository-relative, re-checked; never a URL
  line: number | null,
  explanation: string,      // hedged wording
  evidence: string,         // REQUIRED — no evidence, no finding
  confidence: 'low' | 'medium' | 'high',
  origin: 'local' | 'model',
}
```

Rules enforced in code, not in prose:

- **Evidence required.** A model finding without evidence is dropped.
- **No certainty from weak evidence.** Wording that claims certainty
  ("definitely", "guaranteed", "is a bug", …) fails validation and the
  finding is dropped. The vocabulary is hedged by construction: "Potential
  issue", "Worth checking", "evidence suggests…".
- **Paths are paths.** A file value that is not repository-relative (a URL,
  a traversal path, a hostile string) is dropped at composition time and
  rejected again by the result validator.
- **Bounded.** Findings, affected files, observations, notes, and plan steps
  all have caps.

## Bounded code search

`FIND_CODE` never downloads a repository and never walks an unbounded DOM.
It searches what the page already rendered: the captured code slice, the
captured diff excerpt, the file listing, and the readable page text
(README, issue body). Limits: 20 hits, 160-char snippets, 40 files scanned,
1 s wall-clock budget with an injectable clock (so the timeout is tested),
and a `truncated` flag whenever a cap or the timeout bit. A zero-hit search
reports zero hits — it does not fall back to guessing.

## Change plans: advice plus a typed, bounded navigation proposal

A `GENERATE_CHANGE_PLAN` result is:

1. **A summary** — what the change is about.
2. **Ordered steps** — bounded (≤ 8) advisory steps, derived
   deterministically from findings, change categories, and issue criteria.
   The model may rewrite the *narrative*; it can never add files or steps
   that the deterministic analysis did not derive.
3. **Affected files** — bounded, de-duplicated, ordered by evidence.
4. **A navigation proposal** — at most 4 repository files worth opening,
   expressed as typed targets.

The navigation proposal is the only part that can touch the browser, and it
goes through the Phase 4 Action Engine: a typed `NAVIGATE_GITHUB` step whose
URL is built by CommandLayer from validated identity fields, previewed to the
user, approved explicitly, executed once, and verified. A change plan is
read/navigate only — no edits, no commits, no pushes, no issues, no comments.

## What the AI may and may not do

The developer context handed to the model is a bounded slice: identity, a
capped file list, capped changed files, one code slice, one diff excerpt,
search hits, deterministic observations, and explicit notes about what could
not be read. It is delivered inside a `<developer_context>` block, after the
webpage-data block, and the prompt states that everything inside those
blocks is data.

The model may produce: prose, sections, findings (validated), and an advisory
plan (validated). It may **not** produce: executable actions, URLs, selectors,
shell or JavaScript, permissions, approvals, or scope changes. The response
schema has no field for them, and the Phase 4 planner never reads model
text.

## Memory boundary

Saved memories can inform developer work ("Remember that this repository uses
Spring Boot") and appear in Developer Mode as non-authoritative context.
Memory can never:

- grant a permission or approve an action,
- bypass a confirmation or lower a risk classification,
- authorise a GitHub mutation (none exist),
- override the current user instruction.

Tests assert all four: retrieval is relevance-bound, memory phrasing never
reaches the developer path as an instruction, and a memory record cannot
become an action or an approval.

## Developer Mode UI

An optional presentation toggle (`developerMode`, default off). When it is on
and the current page is GitHub, the side panel shows:

- **Repository** — slug, visibility, language, surface.
- **Current file** — path, language, captured line count.
- **Code context** — how much of the page was read, and whether it was cut.
- **PR / Issue** — change stats, categories, sensitive files, or issue
  requirements.
- **Analysis** — findings with severity, evidence, and confidence.
- **Change plan** — steps, affected files, and the navigation proposal with
  **Allow & run** (which is the Phase 5 approval, not a second one).
- **Saved developer context** — relevant memories, clearly labelled
  non-authoritative.

Developer Mode is presentation only. It does not relax validation, add
permissions, or skip approvals, and everything works without it.

## Security summary

- Untrusted input: every README, source file, issue, pull request, commit
  message, and comment is data, delimited and never authority.
- Injection defence: a fourth delimiter family neutralises attempts to close
  the developer block, and tests inject "ignore previous instructions",
  "reveal secrets", "execute this command", "send this data somewhere",
  "disable security", and "approve this workflow" into every one of those
  surfaces.
- No repository downloads, no arbitrary selectors, no shell, no JavaScript,
  no secrets, no autonomous execution, no replanning.
- All GitHub actions are navigation within github.com, derived from validated
  identity — never from a raw URL string.

## Performance

Caps everywhere, memoised per-request analysis, a wall-clock budget for
search, cancellation honoured through the existing `AbortSignal` plumbing,
and stale-request protection so a late result never replaces a newer one.
Correctness is never traded for speed: when a cap bites, the result says so
via `truncated` and notes.

## Honest limits

- Only what the page rendered is known; a collapsed file, a virtualised diff,
  or a private repository the user cannot see yields less.
- Repository understanding is one level deep (the page's own listing).
- Findings are heuristics expressed as things to check, not a security audit.
- GitHub Enterprise hosts are not treated as GitHub.
- Real Edge was not available in the development environment: validation is
  structural (types, unit tests, jsdom smoke tests against the built bundle)
  and no browser testing is claimed.
