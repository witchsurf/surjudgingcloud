import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePlanningCsv } from '../../../adapters/planningImport/csvParser';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/${name}.csv`), 'utf8');
const codes = (items: readonly { code: string }[]) => items.map((item) => item.code);

describe('canonical planning CSV import', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses nominal rows with exact source rows and canonical metadata', () => {
    const result = parsePlanningCsv(fixture('nominal'), {
      source: 'csv', eventId: 'event-7', sourceName: 'nominal.csv',
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.validRows).toEqual([
      { category: 'OPEN MEN', seed: 1, name: 'Surfer A', country: 'SEN', license: 'LIC-001', sourceRow: 2 },
      { category: 'OPEN MEN', seed: 2, name: 'Surfer B', country: 'SEN', license: 'LIC-002', sourceRow: 3 },
    ]);
    expect(result.input).toMatchObject({ eventId: 'event-7', source: 'csv', sourceName: 'nominal.csv' });
  });

  it('sorts deterministically by normalized category then seed', () => {
    const categories = parsePlanningCsv(fixture('multiple-categories'), { source: 'csv' });
    expect(categories.validRows.map((row) => `${row.category}:${row.seed}`)).toEqual(['OPEN MEN:1', 'OPEN WOMEN:1']);
    const seeds = parsePlanningCsv(fixture('unordered-seeds'), { source: 'csv' });
    expect(seeds.validRows.map((row) => row.seed)).toEqual([1, 2, 3]);
    expect(seeds.validRows.map((row) => row.sourceRow)).toEqual([3, 4, 2]);
  });

  it('uses one logical category across case variants and preserves the first display label', () => {
    const result = parsePlanningCsv(fixture('category-case'), { source: 'csv' });
    expect(result.errors).toEqual([]);
    expect(result.validRows.map((row) => row.category)).toEqual(['OPEN MEN', 'OPEN MEN', 'OPEN MEN']);
  });

  it('compares category accents and case for duplicate seeds', () => {
    const result = parsePlanningCsv(fixture('category-accents'), { source: 'csv' });
    expect(codes(result.errors)).toEqual(['DUPLICATE_SEED']);
    expect(result.errors[0]).toMatchObject({ sourceRow: 3, column: 'seed' });
    expect(result.input).toBeNull();
  });

  it('accepts combined French aliases, BOM and accented participant data', () => {
    const result = parsePlanningCsv(fixture('french-headers'), { source: 'csv' });
    expect(result.errors).toEqual([]);
    expect(result.validRows).toEqual([{
      category: 'OPEN FEMMES', seed: 1, name: 'Aïssatou', country: 'SÉNÉGAL', license: 'SN-001', sourceRow: 2,
    }]);
    const people = parsePlanningCsv(fixture('accented-people'), { source: 'csv' });
    expect(people.validRows.map((row) => row.name)).toEqual(["Aïssatou N'Diaye", 'Maïmouna Diène']);
  });

  it('reports missing required columns before validating rows', () => {
    const result = parsePlanningCsv(fixture('missing-column'), { source: 'csv' });
    expect(codes(result.errors)).toEqual(['REQUIRED_COLUMN_MISSING']);
    expect(result.errors[0]).toMatchObject({ sourceRow: 1, column: 'seed' });
    expect(result.validRows).toEqual([]);
  });

  it('reports empty, missing-header, empty-cell and invalid-row diagnostics exactly', () => {
    expect(codes(parsePlanningCsv('  \n', { source: 'csv' }).errors)).toEqual(['EMPTY_FILE']);
    expect(codes(parsePlanningCsv('\nvalue', { source: 'csv' }).errors)).toEqual(['HEADER_MISSING']);
    const cells = parsePlanningCsv('CATEGORY,SEED,NAME\n,1,A\nOPEN MEN,,B\nOPEN MEN,2,', { source: 'csv' });
    expect(codes(cells.errors)).toEqual(['EMPTY_CATEGORY', 'EMPTY_SEED', 'EMPTY_NAME']);
    expect(cells.errors.map((item) => item.sourceRow)).toEqual([2, 3, 4]);
    const invalid = parsePlanningCsv('CATEGORY,SEED,NAME,EXTRA\n,,,x', { source: 'csv' });
    expect(codes(invalid.errors)).toEqual(['INVALID_ROW']);
  });

  it('rejects non-positive, non-integer and textual seeds without fallback', () => {
    const result = parsePlanningCsv(fixture('invalid-seed'), { source: 'csv' });
    expect(codes(result.errors)).toEqual(['INVALID_SEED', 'INVALID_SEED', 'INVALID_SEED']);
    expect(result.validRows).toEqual([]);
  });

  it('rejects duplicate seeds within a normalized category', () => {
    const result = parsePlanningCsv(fixture('duplicate-seed'), { source: 'csv' });
    expect(codes(result.errors)).toEqual(['DUPLICATE_SEED']);
    expect(result.validRows).toHaveLength(1);
  });

  it('keeps an interior empty row as a warning with its exact source row', () => {
    const result = parsePlanningCsv(fixture('empty-row'), { source: 'csv' });
    expect(codes(result.warnings)).toEqual(['EMPTY_ROW']);
    expect(result.warnings[0]).toMatchObject({ sourceRow: 3, column: null });
    expect(result.validRows.map((row) => row.sourceRow)).toEqual([2, 4]);
  });

  it('allows a missing license and rejects the same non-empty license globally', () => {
    const missing = parsePlanningCsv(fixture('missing-license'), { source: 'csv' });
    expect(missing.errors).toEqual([]);
    expect(missing.validRows[0].license).toBeNull();
    const duplicate = parsePlanningCsv(fixture('duplicate-license'), { source: 'csv' });
    expect(codes(duplicate.errors)).toEqual(['DUPLICATE_PARTICIPANT']);
    expect(duplicate.errors[0]).toMatchObject({ sourceRow: 3, column: 'license' });
  });

  it('warns but does not reject a duplicate normalized name without a license in one category', () => {
    const result = parsePlanningCsv(
      'CATEGORY,SEED,NAME,LICENSE\nOPEN MEN,1,Émile,\nopen men,2,emile,',
      { source: 'csv' },
    );
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual(['DUPLICATE_PARTICIPANT']);
    expect(result.validRows).toHaveLength(2);
    expect(result.input).not.toBeNull();
  });

  it('produces identical participants for local and Google-obtained equivalent CSV text', () => {
    const content = fixture('nominal');
    const local = parsePlanningCsv(content, { source: 'csv' });
    const google = parsePlanningCsv(content, { source: 'google_sheets' });
    expect(google.validRows).toEqual(local.validRows);
    expect(google.errors).toEqual(local.errors);
    expect(google.warnings).toEqual(local.warnings);
    expect(google.input?.source).toBe('google_sheets');
  });

  it('parses locally while offline without any network request', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const result = parsePlanningCsv(fixture('nominal'), { source: 'csv' });
    expect(result.errors).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
