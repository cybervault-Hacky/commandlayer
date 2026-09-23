/**
 * Phase 5 — deterministic task understanding.
 *
 * Before anything is planned, the request is analyzed locally and
 * deterministically (no model in the loop):
 *
 * - what the user is asking for (normalized goal)
 * - which clauses carry sub-goals, and which of them reference the result
 *   of an earlier clause ("…and open the relevant result")
 * - whether the request is a single Phase 4 action, a bounded multi-step
 *   workflow, plain reasoning, or must be refused outright
 * - what the request would require from Page Intelligence
 *
 * Refusal rules (never bypassable, never influenced by page content):
 * - requests for scripts, shell commands, or browser code are refused
 * - requests to forge/skip approval, disable confirmation, or bypass the
 *   sensitive-field block are refused
 *
 * Nothing here executes anything: understanding only classifies text.
 */
import type { PageSection } from '@/shared/types/page';
import { WORKFLOW_LIMITS } from './limits';
import { workflowError, type WorkflowError } from './errors';
import type { WorkflowIntent } from './types';

/** How a request was understood. */
export const TaskKind = {
  /** A single Phase 4 action ("find “React”"). */
  Action: 'ACTION',
  /** A bounded multi-step workflow ("find X and open the result"). */
  Workflow: 'WORKFLOW',
  /** No action involved — the reasoning engine answers it. */
  Reasoning: 'REASONING',
  /** Refused: not something CommandLayer will ever do. */
  Unsupported: 'UNSUPPORTED',
} as const;

export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

export interface TaskUnderstanding {
  goal: string;
  kind: TaskKind;
  /** Ordered intents the plan is expected to contain. */
  intents: WorkflowIntent[];
  /** Human description of the expected outcome (declared before approval). */
  expectedOutcome: string;
  /** Page Intelligence sections the request needs (minimum necessary). */
  contextRequirements: PageSection[];
  supported: boolean;
  reason?: string;
  errorCode?: WorkflowError['code'];
}

/** One clause of the goal text, with its reference role. */
export interface GoalClause {
  text: string;
  /** True when the clause refers to an earlier clause's result. */
  isReference: boolean;
}

export interface GoalAnalysis {
  /** Normalized goal (whitespace-collapsed, bounded). */
  goal: string;
  /** True when the text was too long to treat as a workflow goal. */
  oversized: boolean;
  clauses: GoalClause[];
  /** Present when the request must be refused outright. */
  refusal?: WorkflowError;
  /** True when the text asks for something action-shaped at all. */
  mentionsAction: boolean;
}

/**
 * Requests for executable content. CommandLayer has exactly six registered
 * actions and never runs code: these are refused before planning.
 */
const CODE_REQUEST_PATTERNS: readonly RegExp[] = [
  /\bjavascript\s*:/i,
  /\bdata\s*:\s*text\/html/i,
  /\bvbscript\s*:/i,
  /<\s*\/?\s*script\b/i,
  /\beval\s*\(/i,
  /\bnew\s+function\s*\(/i,
  /\bexec\s*\(/i,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bdocument\s*\.\s*(cookie|location|write)\b/i,
  /\bwindow\s*\.\s*[a-z_$]/i,
  /\bchrome\s*\.\s*[a-z]+\s*\./i,
  /\bbrowser\s*\.\s*[a-z]+\s*\./i,
  /\bnode\s+-e\b/i,
  /\bpython\s+-c\b/i,
  /\b(curl|wget|bash|zsh|powershell|cmd|sudo|chmod|chown)\b/i,
  /\brm\s+-[rf]/i,
  /\b(run|execute|exec)\s+(this|that|the|some|any|my|a)\s+(script|code|command|payload|snippet|program)\b/i,
  /\b(inject|injection)\s+(this\s+)?(script|code|javascript)\b/i,
];

/**
 * Requests to forge approval or to disable a safety control. Free text
 * NEVER grants permission in CommandLayer, and these phrasings are
 * refused explicitly rather than being answered as if they were valid.
 */
const APPROVAL_FORGERY_PATTERNS: readonly RegExp[] = [
  /\bpretend\b[^.]{0,40}\b(approved|approval|permission|granted)\b/i,
  /\bassume\b[^.]{0,40}\b(approved|approval|granted)\b/i,
  /\bbypass\b[^.]{0,40}\b(approval|confirmation|safety|security|permission|check)\b/i,
  /\bskip\b[^.]{0,40}\b(approval|confirmation|permission|safety|security)\b/i,
  /\b(disable|ignore|override|turn off)\b[^.]{0,40}\b(safety|security|confirmation|permission|approval|guard|blocklist)\b/i,
  /\bgrant\s+(yourself|itself|me)\b[^.]{0,30}\bpermission\b/i,
  /\byou\s+(now\s+)?have\s+(full\s+)?(permission|authorization)\b/i,
  /\bno\s+(approval|confirmation|permission)\s+(is\s+)?(needed|required)\b/i,
  /\bignore\b[^.]{0,30}\b(previous|prior|earlier|all)\b[^.]{0,20}\b(instructions|rules|prompts)\b[^.]{0,60}\b(execute|run|perform|do it|act)\b/i,
];

/** Verbs that make a clause action-shaped. */
const ACTION_VERBS =
  /\b(find|search|look for|locate|open|click|press|tap|follow|go to|visit|navigate to|read|scroll|type|enter|fill|write|select|choose)\b/i;

/** Clause separators (top level, outside quotes). */
const SEPARATORS: readonly RegExp[] = [
  /\s+and\s+then\s+/i,
  /\s+then\s+/i,
  /\s+after\s+that\s+/i,
  /\s+and\s+/i,
  /\s*;\s*/,
];

/**
 * Clauses that refer to the previous clause's result instead of naming
 * their own target ("open it", "click the first result", "follow that
 * link"). They are resolved deterministically from page context — or the
 * workflow is refused, never guessed.
 */
const REFERENCE_CLAUSE_PATTERN =
  /^(?:please\s+)?(?:open|click|press|tap|follow|go\s+to|visit|navigate\s+to)\s+(?:it|that|this|these|those|them|(?:the|that|this)\s+(?:(?:relevant|first|top|best|matching|correct|right|resulting)\s+)?(?:result|link|match|one|item|hit|page))\.?$/i;

const MAX_CLAUSES = 6;

/** Is the character at `index` an opening quote delimiter? */
function opensQuote(text: string, index: number): boolean {
  const ch = text[index];
  if (ch === '"' || ch === '“' || ch === '‘') return true;
  // A straight apostrophe only quotes when it opens a word ("'submit'").
  if (ch !== "'") return false;
  const previous = index === 0 ? ' ' : text[index - 1] ?? ' ';
  const next = text[index + 1] ?? ' ';
  return /\s|^/.test(previous) && !/\s/.test(next);
}

/** Does the character at `index` close the quote opened by `quote`? */
function closesQuote(text: string, index: number, quote: string): boolean {
  const ch = text[index];
  if (quote === '“') return ch === '”' || ch === '"';
  if (quote === '‘') return ch === '’' || ch === "'";
  return ch === quote;
}

/** Split on every occurrence of a separator, respecting quoted spans. */
function splitOutsideQuotes(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    if (quote !== null) {
      if (closesQuote(text, i, quote)) quote = null;
      continue;
    }
    if (opensQuote(text, i)) {
      quote = text[i] ?? null;
      continue;
    }
    const rest = text.slice(i);
    const match = separator.exec(rest);
    if (match && match.index === 0) {
      parts.push(text.slice(start, i));
      start = i + match[0].length;
      i = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Split a goal into top-level clauses (bounded count). */
export function splitGoalClauses(text: string): string[] {
  let clauses: string[] = [text];
  for (const separator of SEPARATORS) {
    const next: string[] = [];
    for (const clause of clauses) {
      next.push(...splitOutsideQuotes(clause, separator));
    }
    clauses = next.slice(0, MAX_CLAUSES);
    if (clauses.length >= MAX_CLAUSES) break;
  }
  return clauses
    .map((clause) => normalizeGoal(clause))
    .filter((clause) => clause.length > 0);
}

function normalizeGoal(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Analyze a command's text. Pure and deterministic: same input, same
 * analysis — there is no model, no randomness, and no page dependency.
 */
export function analyzeGoalText(text: string): GoalAnalysis {
  const goal = normalizeGoal(text);
  const oversized = goal.length > WORKFLOW_LIMITS.MAX_GOAL_LENGTH;
  const bounded = goal.slice(0, WORKFLOW_LIMITS.MAX_GOAL_LENGTH);

  if (matchesAny(CODE_REQUEST_PATTERNS, goal)) {
    return {
      goal: bounded,
      oversized,
      clauses: [],
      mentionsAction: true,
      refusal: workflowError('WORKFLOW_UNSAFE_REQUEST'),
    };
  }

  if (matchesAny(APPROVAL_FORGERY_PATTERNS, goal)) {
    return {
      goal: bounded,
      oversized,
      clauses: [],
      mentionsAction: true,
      refusal: workflowError('WORKFLOW_UNSAFE_REQUEST'),
    };
  }

  const clauses: GoalClause[] = splitGoalClauses(goal).map((clause) => ({
    text: clause,
    isReference: REFERENCE_CLAUSE_PATTERN.test(clause),
  }));

  return {
    goal: bounded,
    oversized,
    clauses,
    mentionsAction: ACTION_VERBS.test(goal),
  };
}

/** True when a clause is a result-reference clause (exported for tests). */
export function isReferenceClause(clause: string): boolean {
  return REFERENCE_CLAUSE_PATTERN.test(clause);
}

/** Human sentence describing a workflow's expected outcome. */
export function describeOutcomeForIntents(
  goal: string,
  intents: readonly WorkflowIntent[],
): string {
  if (intents.includes('OPEN')) {
    return `Open the result identified for “${goal}”.`;
  }
  if (intents.includes('READ')) {
    return `Read the page content requested by “${goal}”.`;
  }
  return `Complete the requested steps for “${goal}”.`;
}

/**
 * The Page Intelligence sections a request needs — never more (Phase 2
 * reuse, minimum necessary capture).
 */
export function contextRequirementsForIntents(
  intents: readonly WorkflowIntent[],
): PageSection[] {
  const sections = new Set<PageSection>();
  if (intents.includes('FIND') || intents.includes('IDENTIFY')) {
    sections.add('metadata');
    sections.add('headings');
    sections.add('text');
  }
  if (intents.includes('OPEN')) {
    sections.add('metadata');
    sections.add('links');
  }
  if (intents.includes('READ')) {
    sections.add('metadata');
    sections.add('headings');
    sections.add('text');
  }
  if (sections.size === 0) sections.add('metadata');
  return [...sections];
}
