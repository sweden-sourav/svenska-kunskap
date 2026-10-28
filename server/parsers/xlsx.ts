import ExcelJS from 'exceljs';
import type { ParseIssue, RawQuestion } from '../types.js';
import { parseTabular, type TabularRow } from './tabular.js';

/**
 * Reads every worksheet of an .xlsx workbook. Sheets whose name starts with "_" are ignored,
 * so a workbook can carry notes or instructions next to its question sheets.
 */
export async function parseXlsx(path: string): Promise<{ raws: RawQuestion[]; issues: ParseIssue[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const raws: RawQuestion[] = [];
  const issues: ParseIssue[] = [];

  for (const ws of wb.worksheets) {
    if (ws.name.startsWith('_')) continue;
    const rows: TabularRow[] = [];
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = [];
      for (let c = 1; c <= width; c++) values.push(row.getCell(c).text ?? '');
      rows.push({ values, row: rowNumber });
    });
    const result = parseTabular(rows, `sheet "${ws.name}"`);
    raws.push(...result.raws);
    issues.push(...result.issues);
  }
  return { raws, issues };
}
