import { describe, expect, it } from 'vitest';
import { extractTables } from '../tables';
import { PAGE_LIMITS } from '../limits';
import { createDocument } from './fixtures';

describe('extractTables', () => {
  it('extracts headers and rows', () => {
    const { doc } = createDocument(
      `<html><body>
        <table>
          <thead><tr><th>Name</th><th>Role</th></tr></thead>
          <tbody>
            <tr><td>Ada</td><td>Engineer</td></tr>
            <tr><td>Grace</td><td>Admiral</td></tr>
          </tbody>
        </table>
      </body></html>`,
    );
    const { tables } = extractTables(doc);
    expect(tables).toEqual([
      {
        headers: ['Name', 'Role'],
        rows: [
          ['Ada', 'Engineer'],
          ['Grace', 'Admiral'],
        ],
        truncated: false,
      },
    ]);
  });

  it('handles missing headers and empty cells', () => {
    const { doc } = createDocument(
      `<html><body>
        <table>
          <tr><td>a</td><td></td></tr>
          <tr><td></td><td>b</td></tr>
        </table>
      </body></html>`,
    );
    const { tables } = extractTables(doc);
    expect(tables).toEqual([
      { headers: [], rows: [['a', ''], ['', 'b']], truncated: false },
    ]);
  });

  it('caps rows and columns and reports truncation', () => {
    const rows = Array.from(
      { length: PAGE_LIMITS.MAX_TABLE_ROWS + 4 },
      (_, i) => `<tr><td>cell-${i}</td></tr>`,
    ).join('');
    const { doc } = createDocument(
      `<html><body><table><tbody>${rows}</tbody></table></body></html>`,
    );
    const { tables, truncated } = extractTables(doc);
    expect(tables[0]?.rows).toHaveLength(PAGE_LIMITS.MAX_TABLE_ROWS);
    expect(tables[0]?.truncated).toBe(true);
    expect(truncated).toBe(true);
  });

  it('does not flag truncation when a table fits exactly', () => {
    const cols = Array.from(
      { length: PAGE_LIMITS.MAX_TABLE_COLUMNS },
      (_, i) => `<th>h${i}</th>`,
    ).join('');
    const { doc } = createDocument(
      `<html><body><table><thead><tr>${cols}</tr></thead></table></body></html>`,
    );
    const { tables, truncated } = extractTables(doc);
    expect(tables[0]?.truncated).toBe(false);
    expect(truncated).toBe(false);
  });

  it('skips nested tables and hidden tables', () => {
    const { doc } = createDocument(
      `<html><body>
        <table>
          <tr><td>outer</td><td>
            <table><tr><td>inner</td></tr></table>
          </td></tr>
        </table>
        <table style="display:none"><tr><td>hidden table</td></tr></table>
      </body></html>`,
    );
    const { tables } = extractTables(doc);
    expect(tables).toHaveLength(1);
    expect(JSON.stringify(tables)).not.toContain('inner');
    expect(JSON.stringify(tables)).not.toContain('hidden table');
  });

  it('caps the number of tables', () => {
    const many = Array.from(
      { length: PAGE_LIMITS.MAX_TABLES + 3 },
      (_, i) => `<table><tr><td>t${i}</td></tr></table>`,
    ).join('');
    const { doc } = createDocument(`<html><body>${many}</body></html>`);
    const { tables, truncated } = extractTables(doc);
    expect(tables).toHaveLength(PAGE_LIMITS.MAX_TABLES);
    expect(truncated).toBe(true);
  });
});
