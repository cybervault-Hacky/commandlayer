/**
 * Phase 3 — safe Markdown renderer for validated AI responses.
 *
 * Security model:
 * - NO dangerouslySetInnerHTML, NO innerHTML: every output is a React
 *   element whose text is a plain string node, so HTML/JS in the
 *   Markdown can never execute or inject markup.
 * - Links are rendered only when parseSafeUrl approves the href
 *   (absolute http/https, nothing else). Unsafe links degrade to plain
 *   text.
 * - Node count is capped (AI_LIMITS.MAX_MARKDOWN_NODES) so a huge
 *   response cannot blow up the DOM.
 * - Only a fixed Markdown subset is supported (headings, lists, quotes,
 *   code fences, bold/italic/code, links). Anything else renders as
 *   literal text.
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { parseSafeUrl } from '@/shared/security/url';
import { AI_LIMITS } from '@/ai/limits';

export interface SafeMarkdownProps {
  content: string;
  className?: string;
}

interface Budget {
  nodes: number;
  exhausted: boolean;
}

export function SafeMarkdown({ content, className }: SafeMarkdownProps) {
  const nodes = useMemo(() => renderMarkdownBlocks(content), [content]);
  return <div className={className}>{nodes}</div>;
}

/* ------------------------------------------------------------------ */

const BLOCK_HEAD = /^(#{1,6})\s+(.*)$/;
const BLOCK_QUOTE = /^>\s?/;
const BLOCK_UL = /^\s*[-*+]\s+/;
const BLOCK_OL = /^\s*\d+[.)]\s+/;
const BLOCK_FENCE = /^```/;
const BLOCK_BREAK = /^```|^#{1,6}\s|^>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/;

function renderMarkdownBlocks(source: string): ReactNode[] {
  const budget: Budget = { nodes: 0, exhausted: false };
  const lines = source.split(/\r?\n/);
  const at = (i: number): string => lines[i] ?? '';
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length && !budget.exhausted) {
    const line = at(i);

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block
    if (BLOCK_FENCE.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !BLOCK_FENCE.test(at(i))) {
        code.push(at(i));
        i += 1;
      }
      i += 1; // skip closing fence (or EOF)
      if (spend(budget)) {
        blocks.push(
          <pre key={key++} className="cl-md-code">
            <code>{code.join('\n')}</code>
          </pre>,
        );
      }
      continue;
    }

    // Heading
    const heading = line.match(BLOCK_HEAD);
    if (heading) {
      const level = heading[1]?.length ?? 2;
      const inline = renderInline(heading[2] ?? '', budget);
      if (budget.exhausted) break;
      blocks.push(headingElement(level, inline, key++));
      i += 1;
      continue;
    }

    // Blockquote
    if (BLOCK_QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && BLOCK_QUOTE.test(at(i))) {
        quote.push(at(i).replace(BLOCK_QUOTE, ''));
        i += 1;
      }
      if (spend(budget)) {
        blocks.push(
          <blockquote key={key++} className="cl-md-quote">
            {renderInline(quote.join('\n'), budget)}
          </blockquote>,
        );
      }
      continue;
    }

    // Unordered list
    if (BLOCK_UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BLOCK_UL.test(at(i))) {
        items.push(at(i).replace(BLOCK_UL, ''));
        i += 1;
      }
      if (spend(budget)) {
        blocks.push(
          <ul key={key++} className="cl-md-list">
            {items.map((item, idx) =>
              budget.exhausted ? null : (
                <li key={idx}>{renderInline(item, budget)}</li>
              ),
            )}
          </ul>,
        );
      }
      continue;
    }

    // Ordered list
    if (BLOCK_OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BLOCK_OL.test(at(i))) {
        items.push(at(i).replace(BLOCK_OL, ''));
        i += 1;
      }
      if (spend(budget)) {
        blocks.push(
          <ol key={key++} className="cl-md-list">
            {items.map((item, idx) =>
              budget.exhausted ? null : (
                <li key={idx}>{renderInline(item, budget)}</li>
              ),
            )}
          </ol>,
        );
      }
      continue;
    }

    // Paragraph: consume until blank line or a structural line.
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      at(i).trim() !== '' &&
      !BLOCK_BREAK.test(at(i))
    ) {
      para.push(at(i));
      i += 1;
    }
    if (spend(budget)) {
      blocks.push(
        <p key={key++} className="cl-md-para">
          {renderInline(para.join('\n'), budget)}
        </p>,
      );
    }
  }

  if (budget.exhausted) {
    blocks.push(
      <p key="truncated" className="cl-md-para cl-md-truncated">
        …(response truncated for size)
      </p>,
    );
  }

  return blocks;
}

function headingElement(level: number, inline: ReactNode, key: number) {
  const className = 'cl-md-heading';
  switch (level) {
    case 1:
      return <h2 key={key} className={className}>{inline}</h2>;
    case 2:
      return <h3 key={key} className={className}>{inline}</h3>;
    default:
      return <h4 key={key} className={className}>{inline}</h4>;
  }
}

/**
 * Inline parser: bold, italic, inline code, and safe links. Everything
 * else — including raw HTML — becomes literal text via React string
 * nodes (which auto-escape).
 */
function renderInline(text: string, budget: Budget): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;

  // Order matters: code spans first (their content is never parsed).
  const pattern =
    /(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(_([^_\n]+)_)|(`([^`\n]+)`)|(\[([^\]\n]+)\]\(([^)\s]+)\))/;

  while (rest.length > 0 && !budget.exhausted) {
    const m = pattern.exec(rest);
    if (!m || m.index === undefined) {
      if (spend(budget)) out.push(<Fragment key={key++}>{rest}</Fragment>);
      break;
    }
    if (m.index > 0 && spend(budget)) {
      out.push(<Fragment key={key++}>{rest.slice(0, m.index)}</Fragment>);
    }
    if (!spend(budget)) break;

    if (m[2] !== undefined) {
      out.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[4] !== undefined) {
      out.push(<em key={key++}>{m[4]}</em>);
    } else if (m[6] !== undefined) {
      out.push(<em key={key++}>{m[6]}</em>);
    } else if (m[8] !== undefined) {
      out.push(
        <code key={key++} className="cl-md-inline-code">
          {m[8]}
        </code>,
      );
    } else if (m[9] !== undefined) {
      const label = m[10] ?? '';
      const safe = parseSafeUrl(m[11] ?? '');
      if (safe !== null) {
        out.push(
          <a
            key={key++}
            href={safe.href}
            target="_blank"
            rel="noopener noreferrer"
            className="cl-md-link"
          >
            {label}
          </a>,
        );
      } else {
        // Unsafe href (javascript:, data:, ...) → render as plain text.
        out.push(<Fragment key={key++}>{label}</Fragment>);
      }
    }
    rest = rest.slice((m.index ?? 0) + m[0].length);
  }
  return out;
}

function spend(budget: Budget): boolean {
  if (budget.exhausted) return false;
  budget.nodes += 1;
  if (budget.nodes > AI_LIMITS.MAX_MARKDOWN_NODES) {
    budget.exhausted = true;
    return false;
  }
  return true;
}
