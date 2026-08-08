import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parsePlanningXlsx } from '../xlsxParser';
import { normalizePlanningToken } from '../../../domain/planningImport/normalizeHeaders';

const fixturePath = process.env.REAL_COMPETITION_X_XLSX;

describe.runIf(Boolean(fixturePath))('Competition X real field workbook', () => {
  it('parses the unchanged field file offline with expected category counts', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const file = readFileSync(fixturePath!);
    const input = new ArrayBuffer(file.byteLength);
    new Uint8Array(input).set(file);
    const heapBefore = process.memoryUsage().heapUsed;
    const timings: number[] = [];
    let result!: Awaited<ReturnType<typeof parsePlanningXlsx>>;
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      result = await parsePlanningXlsx(input, { workbookName: basename(fixturePath!) });
      timings.push(performance.now() - started);
    }
    timings.sort((left, right) => left - right);
    const medianMs = timings[2];
    const heapDeltaMiB = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    expect(result.metadata).toEqual({
      workbookName: 'Competition X.xlsx', worksheetName: 'Feuil1', availableWorksheets: ['Feuil1'],
    });
    expect(result.errors).toEqual([]);
    expect(result.validRows).toHaveLength(62);
    expect(result.warnings.every((warning) => warning.code === 'EMPTY_ROW')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    const counts = new Map<string, number>();
    result.validRows.forEach((row) => counts.set(normalizePlanningToken(row.category), (counts.get(normalizePlanningToken(row.category)) ?? 0) + 1));
    expect(Object.fromEntries(counts)).toEqual({
      benjamin: 8,
      cadet: 13,
      junior: 6,
      minime: 4,
      'ondine open': 5,
      'ondine u16': 6,
      open: 20,
    });
    expect(new Set(result.validRows.map((row) => normalizePlanningToken(row.category))).size).toBe(7);
    expect(result.validRows.every((row) => row.license === null)).toBe(true);
    console.info(
      `Competition X XLSX parse: median ${medianMs.toFixed(2)}ms/5, `
      + `heap delta ${heapDeltaMiB.toFixed(2)}MiB (approx.), ${result.warnings.length} blank-row warnings`,
    );
  });
});
