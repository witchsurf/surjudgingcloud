import type {
  CanonicalPlanningColumn,
  NeutralPlanningRow,
  NormalizedPlanningRow,
  PlanningImportDiagnostic,
} from './contracts';
import type { PlanningHeaderResolution } from './normalizeHeaders';

const valueAt = (
  cells: readonly string[],
  indexes: Readonly<Partial<Record<CanonicalPlanningColumn, number>>>,
  column: CanonicalPlanningColumn,
) => {
  const index = indexes[column];
  return index === undefined ? '' : String(cells[index] ?? '').trim();
};

export interface NormalizePlanningRowsResult {
  rows: readonly NormalizedPlanningRow[];
  warnings: readonly PlanningImportDiagnostic[];
  errors: readonly PlanningImportDiagnostic[];
}

export const normalizePlanningRows = (
  rows: readonly NeutralPlanningRow[],
  headers: PlanningHeaderResolution,
): NormalizePlanningRowsResult => {
  const normalized: NormalizedPlanningRow[] = [];
  const warnings: PlanningImportDiagnostic[] = [];
  const errors: PlanningImportDiagnostic[] = [];

  rows.forEach(({ cells, sourceRow }) => {
    if (cells.every((cell) => String(cell ?? '').trim() === '')) {
      warnings.push({
        severity: 'warning', code: 'EMPTY_ROW', message: `Ligne ${sourceRow}: ligne vide ignorée`,
        sourceRow, column: null,
      });
      return;
    }

    const row = {
      sourceRow,
      category: valueAt(cells, headers.indexes, 'category'),
      seed: valueAt(cells, headers.indexes, 'seed'),
      name: valueAt(cells, headers.indexes, 'name'),
      country: valueAt(cells, headers.indexes, 'country'),
      license: valueAt(cells, headers.indexes, 'license'),
    };

    if (!row.category && !row.seed && !row.name && !row.country && !row.license) {
      errors.push({
        severity: 'error', code: 'INVALID_ROW', message: `Ligne ${sourceRow}: aucune donnée reconnue`,
        sourceRow, column: null,
      });
      return;
    }
    normalized.push(row);
  });

  return { rows: normalized, warnings, errors };
};
