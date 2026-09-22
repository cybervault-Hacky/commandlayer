import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeMarkdown } from '../SafeMarkdown';

describe('SafeMarkdown (validated AI output rendering)', () => {
  it('renders headings, paragraphs, lists, quotes and code', () => {
    render(
      <SafeMarkdown
        content={[
          '## Section',
          'A paragraph with **bold**, *italic* and `code`.',
          '- one',
          '- two',
          '> quoted',
          '```',
          'const x = 1;',
          '```',
        ].join('\n')}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Section' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  it('renders safe http/https links with noopener protection', () => {
    render(
      <SafeMarkdown content="See [the docs](https://example.org/docs)." />,
    );
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://example.org/docs');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('never renders javascript: or data: links as anchors', () => {
    const { container } = render(
      <SafeMarkdown
        content={'[pwn](javascript:alert(1)) and [x](data:text/html,<script>x</script>)'}
      />,
    );
    expect(container.querySelectorAll('a').length).toBe(0);
    // Labels survive as inert text.
    expect(container.textContent).toContain('pwn');
  });

  it('renders raw HTML as literal text, never as elements', () => {
    const evil =
      '<script>window.__pwned = true</script><img src=x onerror=alert(1)><b>hi</b>';
    const { container } = render(<SafeMarkdown content={evil} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>window.__pwned = true</script>');
  });

  it('does not use innerHTML anywhere in its output', () => {
    const { container } = render(
      <SafeMarkdown content={'**bold** and <svg/onload=alert(1)> text'} />,
    );
    // No injected elements of any kinds beyond our known markdown nodes.
    for (const el of Array.from(container.querySelectorAll('*'))) {
      expect(['DIV', 'P', 'STRONG', 'EM', 'CODE', 'A', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE']).toContain(
        el.tagName,
      );
    }
  });

  it('caps the number of rendered nodes for runaway responses', () => {
    const huge = Array.from({ length: 2000 }, (_, i) => `- item ${i}`).join('\n');
    const { container } = render(<SafeMarkdown content={huge} />);
    const items = container.querySelectorAll('li').length;
    expect(items).toBeLessThan(2000);
    expect(container.textContent).toContain('truncated for size');
  });
});
