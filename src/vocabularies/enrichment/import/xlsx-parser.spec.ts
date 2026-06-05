import * as XLSX from 'xlsx';
import { parseSpreadsheet } from '@/vocabularies/enrichment/import/xlsx-parser';

// Build an .xlsx buffer in-memory (no fixture file) and round-trip it.
function buildXlsxBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseSpreadsheet', () => {
  it('collects every non-empty cell as a trimmed string', () => {
    const buffer = buildXlsxBuffer([
      ['Word', 'Notes'],
      ['ephemeral', 'adjective'],
      ['  run  ', ''],
      [null, 'serendipity'],
    ]);
    const cells = parseSpreadsheet(buffer);
    expect(cells).toEqual([
      'Word',
      'Notes',
      'ephemeral',
      'adjective',
      'run',
      'serendipity',
    ]);
  });

  it('stringifies numeric cells', () => {
    const buffer = buildXlsxBuffer([['alpha', 42]]);
    expect(parseSpreadsheet(buffer)).toEqual(['alpha', '42']);
  });

  it('returns [] for an empty workbook', () => {
    expect(parseSpreadsheet(buildXlsxBuffer([]))).toEqual([]);
  });
});
