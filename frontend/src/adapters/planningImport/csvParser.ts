import Papa from 'papaparse';
import type {
  NeutralPlanningRow,
  PlanningImportDiagnostic,
  PlanningImportParseOptions,
  PlanningImportParseResult,
} from '../../domain/planningImport/contracts';
import { normalizePlanningHeaders } from '../../domain/planningImport/normalizeHeaders';
import { normalizePlanningRows } from '../../domain/planningImport/normalizeRows';
import { validatePlanningRows } from '../../domain/planningImport/validate';

const csvError = (message: string, sourceRow: number | null): PlanningImportDiagnostic => ({
  severity: 'error', code: 'CSV_PARSE_ERROR', message, sourceRow, column: null,
});

export const parsePlanningCsv = (
  content: string,
  options: PlanningImportParseOptions = { source: 'csv' },
): PlanningImportParseResult => {
  if (!content.replace(/^\uFEFF/, '').trim()) {
    const diagnostic: PlanningImportDiagnostic = {
      severity: 'error', code: 'EMPTY_FILE', message: 'Fichier vide', sourceRow: null, column: null,
    };
    return { validRows: [], warnings: [], errors: [diagnostic], input: null };
  }

  const parsed = Papa.parse<string[]>(content, { header: false, skipEmptyLines: false });
  const matrix = (parsed.data ?? []).map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []);
  while (matrix.length > 1 && matrix.at(-1)?.every((cell) => !cell.trim())) matrix.pop();
  const headerCells = matrix[0] ?? [];
  if (headerCells.every((cell) => !cell.replace(/^\uFEFF/, '').trim())) {
    const diagnostic: PlanningImportDiagnostic = {
      severity: 'error', code: 'HEADER_MISSING', message: 'En-tête CSV absent', sourceRow: 1, column: null,
    };
    return { validRows: [], warnings: [], errors: [diagnostic], input: null };
  }

  const headers = normalizePlanningHeaders(headerCells);
  const neutralRows: NeutralPlanningRow[] = matrix.slice(1).map((cells, index) => ({ sourceRow: index + 2, cells }));
  const normalized = normalizePlanningRows(neutralRows, headers);
  const parserErrors = parsed.errors.filter((item) => item.code !== 'UndetectableDelimiter').map((item) => csvError(
    `Ligne ${(item.row ?? 0) + 1}: ${item.message}`,
    item.row === undefined ? null : item.row + 1,
  ));

  return validatePlanningRows({
    rows: normalized.rows,
    headers,
    options,
    warnings: normalized.warnings,
    errors: [...normalized.errors, ...parserErrors],
  });
};
