import type { PageTable } from '@/shared/types/page';
import { PAGE_LIMITS } from './limits';
import { elementText } from './sanitizer';
import { isElementVisible } from './visibility';

/**
 * Cell text without nested-table content: nested tables are structural
 * noise here (they are never followed), so their text is excluded from
 * the containing cell.
 */
function cellText(cell: Element, maxLength: number): string {
  try {
    const clone = cell.cloneNode(true) as Element;
    for (const nested of Array.from(clone.querySelectorAll('table'))) {
      nested.remove();
    }
    return elementText(clone, maxLength);
  } catch {
    return elementText(cell, maxLength);
  }
}

/**
 * Basic structural table extraction: header row (th), data rows (td),
 * missing headers and empty cells handled, bounded rows/columns.
 * Nested tables are not followed.
 */
export function extractTables(doc: Document): {
  tables: PageTable[];
  truncated: boolean;
} {
  const tables: PageTable[] = [];
  let truncated = false;

  const nodes = doc.querySelectorAll('table');
  for (const node of Array.from(nodes)) {
    if (tables.length >= PAGE_LIMITS.MAX_TABLES) {
      truncated = true;
      break;
    }
    // Nested tables: skip a table whose ancestor chain contains another
    // (closest() matches the element itself, so test the parent chain).
    if (node.parentElement?.closest('table')) continue;
    if (!isElementVisible(node)) continue;

    // Only cells/rows that belong to THIS table (nested tables are skipped,
    // never followed).
    const headerCellNodes = Array.from(
      node.querySelectorAll('thead th, thead td'),
    ).filter((cell) => cell.closest('table') === node);
    const headers = headerCellNodes
      .slice(0, PAGE_LIMITS.MAX_TABLE_COLUMNS)
      .map((cell) => cellText(cell, PAGE_LIMITS.MAX_CELL_LENGTH));

    const dataRowNodes = Array.from(node.querySelectorAll('tr')).filter(
      (row) => row.closest('table') === node && !row.closest('thead'),
    );
    const rows: string[][] = [];
    let tableTruncated =
      headerCellNodes.length > PAGE_LIMITS.MAX_TABLE_COLUMNS ||
      dataRowNodes.length > PAGE_LIMITS.MAX_TABLE_ROWS;

    for (const row of dataRowNodes) {
      if (rows.length >= PAGE_LIMITS.MAX_TABLE_ROWS) {
        tableTruncated = true;
        break;
      }
      const cells = Array.from(row.querySelectorAll('td, th')).filter(
        (cell) => cell.closest('table') === node,
      );
      if (cells.length === 0) continue;
      const values: string[] = [];
      for (const cell of cells.slice(0, PAGE_LIMITS.MAX_TABLE_COLUMNS)) {
        values.push(cellText(cell, PAGE_LIMITS.MAX_CELL_LENGTH));
      }
      rows.push(values);
    }

    if (rows.length > 0 || headers.length > 0) {
      tables.push({ headers, rows, truncated: tableTruncated });
    }
    truncated = truncated || tableTruncated;
  }

  return { tables, truncated };
}
