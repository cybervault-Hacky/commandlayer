# GitHub integration

Phase 7 adds GitHub awareness to CommandLayer. This document states exactly
what is read, how it is validated, and what is deliberately **not** built.

## Two modes, one of which exists

| Mode | Status | What it does |
| --- | --- | --- |
| **A — Page context** | Implemented | Reads the structure of the GitHub page the user already has open, through CommandLayer's own page-intelligence engine. No network, no account, no permissions beyond what Phase 1 already requested. |
| **B — Authenticated API** | **Disabled** | Typed boundary only. No OAuth flow, no token storage, no GitHub API client. `isAuthenticatedModeAvailable()` returns `false` and `requestGitHubApi()` always refuses with `GITHUB_AUTH_DISABLED`. |

Mode A is the whole feature. CommandLayer never talks to `api.github.com`:
everything it knows about a repository comes from the DOM the user is
looking at, which means it works without an account, cannot leak a token,
and cannot act on repositories the user is not already viewing.

## Mode A — how a page becomes GitHub context

```
URL (deterministic)  →  page metadata  →  rendered structure
      detect.ts            parse.ts            parse.ts
```

1. **URL first.** `detectGitHub(url)` parses the path and recognises the
   supported surfaces: `repository`, `file`, `directory`, `commit`,
   `pull_request`, `issue`, `discussion`, `release`, `search`, and
   `unknown` (for everything else on github.com — actions, branches, wiki,
   settings, profiles…). Detection is a pure function of the URL: fast,
   testable without a DOM, and impossible to steer with page content.
2. **Metadata corroborates.** `octolytics-dimension-repository_nwo`,
   `octolytics-dimension-repository_public`, `og:title`, `og:description`
   refine the identity the URL already established. If metadata and URL
   disagree, the URL wins for identity and the difference is reported
   through `evidence`.
3. **Rendered structure fills in details.** Bounded link analysis for file
   and directory listings, `[data-path]` entries for changed files,
   `[data-line-number]` rows for a code slice or a diff excerpt, and the
   README article on repository pages.

Nothing is captured by a single fragile selector: every field is
independently guarded and independently capped, so a markup change degrades
one field instead of breaking the capture.

### Evidence, not assumptions

`GitHubEvidence` records where a context came from — `url`, `meta`, `dom` —
and `truncated` records whether any bounded section was cut short. The UI
shows both. A context that only came from the URL is presented as such.

## What is captured, and how much

| Section | Cap | Source |
| --- | --- | --- |
| Owner / repository / ref / path | 39 / 100 / 255 / 400 chars, 20 path segments | URL, metadata |
| File listing | 60 entries | Links, `[data-path]` |
| Changed files (PR/commit) | 50 entries | `[data-path]`, diffstat |
| Code slice (file pages) | 120 lines, 200 chars/line, 12 000 chars total | `[data-line-number]` rows |
| Diff excerpt (PR/commit) | 150 lines, 200 chars/line, 8 000 chars total | `[data-line-number]` rows |
| README excerpt | 2 000 chars | Article body |
| DOM work | 4 000 nodes, 400 candidates scanned | — |

Every cap lives in `src/github/limits.ts`. The background re-validates the
whole payload with `parseGitHubPageContext` (closed schema, bounded arrays,
bounded strings, repository path rules) before the developer layer can use a
single byte of it.

## What is never read

- Form values, input contents, password fields (Phase 2 rule, unchanged).
- Cookies, session state, account identity, private repository membership.
- Anything outside the visible page: no API calls, no repository downloads,
  no raw file fetches, no crawl of linked pages.
- Private data the user did not open: capture is scoped to the page they are
  on, and the file/diff caps mean even a huge pull request is a bounded
  excerpt.

## Mode B — why it is disabled, and what enabling it would require

Signed-in GitHub access would need, at minimum:

1. a real OAuth device or web flow with a per-install client id,
2. a token store that is neither source, nor a shipped bundle, nor
   `localStorage`, nor a memory record — i.e. a dedicated credential
   architecture with rotation and revocation,
3. a host-permission model that keeps least privilege while allowing
   `api.github.com` calls,
4. a review of rate limits, scope minimisation, and what happens when a user
   signs out mid-session.

None of that is safe to improvise inside this phase, so it is not
improvised. What exists instead:

- `src/integrations/github/types.ts` — the typed boundary (`page_context` vs
  `authenticated`), with `authenticatedAvailable: false` as a literal type.
- `src/integrations/github/client.ts` — status reporting and an API entry
  point that validates its input and then refuses. It performs no I/O and
  holds no credentials.
- `src/integrations/github/validators.ts` — request validation plus
  `containsCredentialMaterial()`, which rejects GitHub token shapes
  (`ghp_…`, `github_pat_…`), bearer headers, and `token=`/`password=` style
  material anywhere it appears. Tests assert that a credential-shaped value
  cannot pass the boundary.

There is no `chrome.identity` usage, no `import.meta.env.VITE_*` secret read,
no `localStorage` write, and no token field in any type. A test walks the
whole `src/` tree (comments stripped) and fails if any of those appear.

## Permissions

Phase 7 adds **no** permissions. The manifest still declares exactly
`commands`, `sidePanel`, `storage`, `tabs`, plus content scripts on
`http://*/*` and `https://*/*`. It does not request `<all_urls>`, cookies,
history, downloads, debugger, nativeMessaging, or management. Reading a
GitHub page needs nothing new: page intelligence already runs on the
active tab and the background already validates what it receives.

GitHub actions that change the page (opening a repository, file, commit,
pull request, issue, or search result) are typed `NAVIGATE_GITHUB` steps
that go through the Phase 4 Action Engine and the Phase 5 approval flow —
read/navigate only. Nothing in CommandLayer can create, comment on, close,
merge, review, approve, delete, or push: those mutations are absent from the
action vocabulary, the validator, and the planner.

## Honest limits

- A page whose markup changed may yield fewer fields; the UI says
  "bounded render" rather than guessing.
- The diff excerpt is what GitHub rendered, not the full patch.
- Repository understanding is limited to what the page lists — typically one
  directory level, not a recursive tree.
- GitHub Enterprise hosts (`github.example.com`) are intentionally **not**
  treated as GitHub, so nothing is assumed about them.
