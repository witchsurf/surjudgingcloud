import { zipSync, strToU8 } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePlanningCsv } from '../csvParser';
import { parsePlanningXlsx } from '../xlsxParser';

type Cell = string | number | null;
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const columnName = (index: number) => String.fromCharCode(65 + index);

const workbookFixture = (sheets: Array<{ name: string; rows: Cell[][] }>): ArrayBuffer => {
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
    </Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
    </workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
    </Relationships>`);
  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((cell, cellIndex) => {
        if (cell === null) return '';
        const ref = `${columnName(cellIndex)}${rowIndex + 1}`;
        return typeof cell === 'number'
          ? `<c r="${ref}"><v>${cell}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
};

const participantRows: Cell[][] = [
  ['CATEGORY', 'SEED', 'NAME', 'COUNTRY', 'LICENSE'],
  ['OPEN MEN', 1, 'Surfer A', 'SEN', 'LIC-001'],
  ['OPEN MEN', 2, 'Surfer B', 'SEN', 'LIC-002'],
];

describe('offline XLSX planning adapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses Participants when present and returns workbook metadata', async () => {
    const input = workbookFixture([
      { name: 'Notes', rows: [['ignore']] },
      { name: 'Participants', rows: participantRows },
    ]);
    const result = await parsePlanningXlsx(input, { workbookName: 'fixture.xlsx' });
    expect(result.errors).toEqual([]);
    expect(result.metadata).toEqual({
      workbookName: 'fixture.xlsx', worksheetName: 'Participants', availableWorksheets: ['Notes', 'Participants'],
    });
    expect(result.validRows).toHaveLength(2);
  });

  it('auto-selects a single non-Participants worksheet and preserves blank source rows', async () => {
    const rows = [participantRows[0], participantRows[1], [null, null, null, null, null], participantRows[2]];
    const result = await parsePlanningXlsx(workbookFixture([{ name: 'Feuil1', rows }]), { workbookName: 'field.xlsx' });
    expect(result.metadata.worksheetName).toBe('Feuil1');
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'EMPTY_ROW', sourceRow: 3 })]);
    expect(result.validRows.map((row) => row.sourceRow)).toEqual([2, 4]);
  });

  it('requires selection for multiple non-Participants sheets and supports explicit selection', async () => {
    const input = workbookFixture([{ name: 'A', rows: participantRows }, { name: 'B', rows: participantRows }]);
    const pending = await parsePlanningXlsx(input, { workbookName: 'multi.xlsx' });
    expect(pending.errors[0].code).toBe('WORKSHEET_SELECTION_REQUIRED');
    expect(pending.metadata.availableWorksheets).toEqual(['A', 'B']);
    const selected = await parsePlanningXlsx(input, { workbookName: 'multi.xlsx', worksheetName: 'b' });
    expect(selected.errors).toEqual([]);
    expect(selected.metadata.worksheetName).toBe('B');
  });

  it('produces the same canonical rows as equivalent CSV', async () => {
    const xlsx = await parsePlanningXlsx(workbookFixture([{ name: 'Feuil1', rows: participantRows }]), { workbookName: 'same.xlsx' });
    const csv = parsePlanningCsv('CATEGORY,SEED,NAME,COUNTRY,LICENSE\nOPEN MEN,1,Surfer A,SEN,LIC-001\nOPEN MEN,2,Surfer B,SEN,LIC-002', { source: 'csv' });
    expect(xlsx.validRows).toEqual(csv.validRows);
    expect(xlsx.errors).toEqual(csv.errors);
    expect(xlsx.warnings).toEqual(csv.warnings);
  });

  it('preserves text leading zeros and characterizes numeric license conversion', async () => {
    const rows: Cell[][] = [
      ['CATEGORY', 'SEED', 'NAME', 'LICENSE'],
      ['OPEN MEN', 1, 'Text license', '00123'],
      ['OPEN MEN', '2', 'Numeric license', 456],
    ];
    const result = await parsePlanningXlsx(workbookFixture([{ name: 'Participants', rows }]), { workbookName: 'types.xlsx' });
    expect(result.errors).toEqual([]);
    expect(result.validRows.map((row) => [row.seed, row.license])).toEqual([[1, '00123'], [2, '456']]);
  });

  it('parses ArrayBuffer offline without fetch or persistence', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const result = await parsePlanningXlsx(workbookFixture([{ name: 'Feuil1', rows: participantRows }]), { workbookName: 'offline.xlsx' });
    expect(result.errors).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
