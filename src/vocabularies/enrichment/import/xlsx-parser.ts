import * as XLSX from 'xlsx';

/**
 * Extract every non-empty cell value from the first sheet of a spreadsheet
 * buffer, as trimmed strings, row by row. Handles both .xlsx and .csv (SheetJS
 * sniffs the format). Numbers/dates are stringified. The caller treats each
 * cell as one candidate entry.
 */
export function parseSpreadsheet(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });

  const cells: string[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (
        typeof cell !== 'string' &&
        typeof cell !== 'number' &&
        typeof cell !== 'boolean'
      ) {
        continue;
      }
      const value = String(cell).trim();
      if (value) cells.push(value);
    }
  }
  return cells;
}
