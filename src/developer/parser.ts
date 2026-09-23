/**
 * Phase 7 — deterministic developer-command parsing.
 *
 * No model, no classification service: a closed, ordered rule list. Order
 * matters (the specific phrasings win over the general ones) and the parser is
 * deliberately conservative:
 *
 * - it only understands phrasings that clearly mean developer work;
 * - a plain `find "pricing"` is NOT claimed (that is the Phase 4 in-page
 *   find, which keeps working exactly as before) because code search requires
 *   a code-search cue;
 * - the caller (`dispatcher`) additionally requires that a GitHub context
 *   actually exists, so a developer phrasing on a non-GitHub page never
 *   hijacks normal behaviour.
 */
import { DeveloperIntent } from './intents';
import { DEVELOPER_LIMITS } from './limits';
import type { DeveloperRequest } from './types';

const CODE_TARGET =
  '(?:code|symbol|function|method|definition|implementation|usages?|usage|caller|callers|reference|references|authentication|auth|authorization|login|endpoint|endpoints|api|apis|route|routes|router|handler|handlers|service|services|component|components|configuration|config|database|db|schema|migration|migrations|query|queries|table|model|models|setting|settings|feature flag|feature flags|pipeline|middleware)';

const RULES: ReadonlyArray<readonly [DeveloperIntent, RegExp]> = [
  // --- plans that convert an issue into work (checked before issue analysis)
  [
    DeveloperIntent.GenerateChangePlan,
    /\b(turn|convert|translate)\b[^.]{0,80}\b(issue|ticket|request)\b[^.]{0,80}\b(plan|implementation|changes?|work)\b/i,
  ],
  [
    DeveloperIntent.GenerateChangePlan,
    /\b(change|implementation|fix|refactor|migration|test|rollout)\s+plan\b/i,
  ],
  [
    DeveloperIntent.GenerateChangePlan,
    /\b(plan|prepare|draft|outline)\b[^.]{0,60}\b(fix|change|implement|implementation|update|refactor)\b/i,
  ],
  [
    DeveloperIntent.GenerateChangePlan,
    /\bhow (would|should|do) (i|you|we)\b[^.]{0,60}\b(fix|implement|change|refactor|add)\b/i,
  ],

  // --- reviews and change analysis ---------------------------------------
  [
    DeveloperIntent.ReviewPullRequest,
    /\b(review|critique|assess|check)\b[^.]{0,50}\b(pr|pull request|pull-request|changes|change set|diff|patch)\b/i,
  ],
  [
    DeveloperIntent.ReviewPullRequest,
    /\b(review|critique)\b[^.]{0,30}\b(this|the|my)\b\s*$/i,
  ],
  [
    DeveloperIntent.AnalyzeDiff,
    /\b(important|key|main|significant|notable|risky|riskiest)\b[^.]{0,30}\bchanges\b/i,
  ],
  [
    DeveloperIntent.AnalyzeDiff,
    /\b(analy[sz]e|explain|summari[sz]e|show|describe|walk me through)\b[^.]{0,50}\b(changes|diff|patch|commit changes|commit diff|commit history)\b/i,
  ],
  [
    DeveloperIntent.SummarizeCommit,
    /\b(summari[sz]e|explain|describe|what (did|does))\b[^.]{0,40}\bcommit\b/i,
  ],

  // --- issues -------------------------------------------------------------
  [
    DeveloperIntent.AnalyzeIssue,
    /\b(summari[sz]e|explain|analy[sz]e|interpret|read|understand)\b[^.]{0,40}\b(issue|ticket|bug report)\b/i,
  ],
  [
    DeveloperIntent.AnalyzeIssue,
    /\bwhat (is|does)\b[^.]{0,40}\b(issue|ticket)\b[^.]{0,40}\b(about|asking|require)\b/i,
  ],

  // --- repository / file / code comprehension -----------------------------
  [
    DeveloperIntent.ExplainRepository,
    /\b(explain|describe|summari[sz]e|understand|overview of|what is|what's)\b[^.]{0,40}\b(repositor(y|ies)|repo|codebase|project)\b/i,
  ],
  [
    DeveloperIntent.ExplainRepository,
    /\b(explain|describe|summari[sz]e)\b[^.]{0,20}\bthis\b[^.]{0,20}\b(repo|repositor(y|ies)|codebase)\b/i,
  ],
  [
    DeveloperIntent.ExplainFile,
    /\b(explain|describe|summari[sz]e|walk me through|what (does|is))\b[^.]{0,40}\b(file|module|class|component|test file|config file)\b/i,
  ],
  [
    DeveloperIntent.ExplainCode,
    /\b(explain|walk me through|what does|what is|how does)\b[^.]{0,40}\b(?:this|that|the)\b[^.]{0,20}\b(code|function|method|snippet|implementation|logic)\b/i,
  ],
  [
    DeveloperIntent.ExplainCode,
    /\b(explain|walk me through)\b[^.]{0,20}\b(this|that|it)\b\s*$/i,
  ],

  // --- analysis-flavoured searches ---------------------------------------
  [
    DeveloperIntent.FindPotentialBugs,
    /\b(find|look for|spot|detect|check for|are there)\b[^.]{0,40}\b(bugs?|defects?|flaws?|vulnerabilit(y|ies)|problems?|issues?|smells?)\b/i,
  ],
  [
    DeveloperIntent.FindTodos,
    /\b(find|list|show|collect)\b[^.]{0,40}\b(todos?|to-dos?|fixmes?|hacks?|unfinished|outstanding|incomplete)\b/i,
  ],
  [
    DeveloperIntent.FindTodos,
    /\b(todos?|fixmes?|hacks?)\b[^.]{0,30}\b(in|across|throughout)\b[^.]{0,30}\b(repo|repositor(y|ies)|code|project|file|files)\b/i,
  ],
  [
    DeveloperIntent.CompareCode,
    /\bcompare\b[^.]{0,40}\b(files?|versions?|implementations?|branches?|approaches?)\b/i,
  ],
  [
    DeveloperIntent.CompareCode,
    /\b(difference|diff)s? between\b/i,
  ],

  // --- bounded code search -------------------------------------------------
  [
    DeveloperIntent.FindCode,
    new RegExp(
      `\\b(find|locate|search for|look for|show me|where (?:is|are)|which files?|what files?)\\b[^.]{0,60}\\b${CODE_TARGET}\\b`,
      'i',
    ),
  ],
  [
    DeveloperIntent.FindCode,
    new RegExp(`\\b(find|locate|show)\\b[^.]{0,40}\\bwhere\\b[^.]{0,40}\\b${CODE_TARGET}\\b`, 'i'),
  ],
  [
    DeveloperIntent.FindCode,
    new RegExp(`\\b(find|locate)\\b[^.]{0,40}\\b(defined|declared|implemented|used)\\b`, 'i'),
  ],
  [
    DeveloperIntent.FindCode,
    /\b(?:which|what)\s+files?\b[^.]{0,60}\b(use|uses|import|imports|reference|references|define|defines|call|calls|handle|handles|implement|implements|contain|contains)\b/i,
  ],
];

/** Words that carry no search value when extracting a target phrase. */
const FILLER = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'our', 'your',
  'please', 'me', 'find', 'locate', 'show', 'search', 'look', 'for', 'where',
  'is', 'are', 'was', 'were', 'which', 'what', 'in', 'on', 'at', 'of', 'to',
  'explain', 'describe', 'summarize', 'summarise', 'analyse', 'analyze',
  'review', 'check', 'critique', 'read', 'understand', 'interpret', 'todo',
  'todos', 'fixme', 'fixmes', 'code', 'codes', 'file', 'files', 'repo',
  'repository', 'repositories', 'codebase', 'project', 'implementation',
  'used', 'define', 'defined', 'declared', 'implemented', 'please',
  'and', 'or', 'with', 'about', 'into', 'from', 'usages', 'usage',
]);

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract the target phrase. A quoted phrase always wins (the user named the
 * exact target); otherwise filler words are stripped and what remains is the
 * target — never a fabricated one.
 */
export function extractDeveloperQuery(text: string): string {
  const quoted = /["“'‘]([^"”'’]{1,120})["”'’]/.exec(text);
  if (quoted?.[1]) return normalize(quoted[1]).slice(0, DEVELOPER_LIMITS.MAX_QUERY_LENGTH);

  const words = normalize(text).split(' ');
  const kept = words.filter((word) => {
    const clean = word.toLowerCase().replace(/[^a-z0-9+#._/-]/g, '');
    return clean.length > 0 && !FILLER.has(clean);
  });
  const phrase = kept.join(' ');
  if (phrase.length >= DEVELOPER_LIMITS.MIN_QUERY_LENGTH) {
    return phrase.slice(0, DEVELOPER_LIMITS.MAX_QUERY_LENGTH);
  }
  return normalize(text).slice(0, DEVELOPER_LIMITS.MAX_QUERY_LENGTH);
}

/**
 * Parse one command as a developer request. Returns null when the phrasing is
 * not a developer request (the caller then keeps its normal behaviour).
 */
export function parseDeveloperRequest(raw: string): DeveloperRequest | null {
  if (typeof raw !== 'string') return null;
  const text = normalize(raw);
  if (text.length === 0 || text.length > DEVELOPER_LIMITS.MAX_COMMAND_LENGTH) return null;

  for (const [intent, pattern] of RULES) {
    if (pattern.test(text)) {
      return {
        intent,
        query: extractDeveloperQuery(text),
        text: text.slice(0, DEVELOPER_LIMITS.MAX_COMMAND_LENGTH),
      };
    }
  }
  return null;
}

/** True when a phrasing is developer work (used for diagnostics/tests). */
export function isDeveloperRequest(text: string): boolean {
  return parseDeveloperRequest(text) !== null;
}
