import writeExcelFile from 'write-excel-file/browser';

type ExportRecord = Record<string, unknown>;
type ExcelValue = string | number | boolean | Date | null;

const INVALID_SHEET_NAME_CHARACTERS = /[\\/?*:[\]]/g;
const MAX_SHEET_NAME_LENGTH = 31;

function normalizeCellValue(value: unknown): ExcelValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  return JSON.stringify(value);
}

export function sanitizeExcelSheetName(sheetName: string): string {
  const sanitized = sheetName.replace(INVALID_SHEET_NAME_CHARACTERS, ' ').trim();
  return (sanitized || 'Report').slice(0, MAX_SHEET_NAME_LENGTH);
}

export function buildExcelSheetData(records: ExportRecord[], readable = false) {
  const headers = Array.from(new Set(records.flatMap(record => Object.keys(record))));

  return [
    headers.map(header => ({
      value: header,
      type: String,
      fontWeight: 'bold' as const,
      backgroundColor: '#E5E7EB'
    })),
    ...records.map(record => headers.map(header => readable ? { value: normalizeCellValue(record[header]), wrap: true } : normalizeCellValue(record[header])))
  ];
}

export async function exportRecordsToExcel(
  records: ExportRecord[],
  sheetName: string,
  fileName: string,
  options: { readable?: boolean } = {}
): Promise<void> {
  if (records.length === 0) {
    throw new Error('Cannot export an empty report.');
  }

  await writeExcelFile(buildExcelSheetData(records, options.readable), {
    sheet: sanitizeExcelSheetName(sheetName),
    stickyRowsCount: 1,
    ...(options.readable ? { columns: Array.from(new Set(records.flatMap(record => Object.keys(record)))).map(header => ({ width: /By|Purpose|Notes/.test(header) ? 36 : /At/.test(header) ? 28 : 22 })) } : {})
  }).toFile(fileName);
}
