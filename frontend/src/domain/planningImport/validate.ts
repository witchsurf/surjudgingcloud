import type {
  CanonicalPlanningColumn,
  NormalizedPlanningRow,
  PlanningImportDiagnostic,
  PlanningImportParseOptions,
  PlanningImportParseResult,
  PlanningImportParticipant,
} from './contracts';
import type { PlanningHeaderResolution } from './normalizeHeaders';
import { normalizePlanningToken } from './normalizeHeaders';

const requiredColumns: readonly CanonicalPlanningColumn[] = ['category', 'seed', 'name'];

const error = (
  code: PlanningImportDiagnostic['code'], message: string,
  sourceRow: number | null, column: PlanningImportDiagnostic['column'],
): PlanningImportDiagnostic => ({ severity: 'error', code, message, sourceRow, column });

const warning = (
  code: PlanningImportDiagnostic['code'], message: string,
  sourceRow: number | null, column: PlanningImportDiagnostic['column'],
): PlanningImportDiagnostic => ({ severity: 'warning', code, message, sourceRow, column });

export interface ValidatePlanningRowsInput {
  rows: readonly NormalizedPlanningRow[];
  headers: PlanningHeaderResolution;
  options: PlanningImportParseOptions;
  warnings?: readonly PlanningImportDiagnostic[];
  errors?: readonly PlanningImportDiagnostic[];
}

export const validatePlanningRows = ({
  rows, headers, options, warnings: initialWarnings = [], errors: initialErrors = [],
}: ValidatePlanningRowsInput): PlanningImportParseResult => {
  const warnings = [...initialWarnings];
  const errors = [...initialErrors];
  const validRows: PlanningImportParticipant[] = [];
  const categoryLabels = new Map<string, string>();
  const seeds = new Map<string, Map<number, number>>();
  const licenses = new Map<string, number>();
  const unlicensedNames = new Map<string, number>();

  requiredColumns.forEach((column) => {
    if (headers.indexes[column] === undefined) {
      errors.push(error('REQUIRED_COLUMN_MISSING', `Colonne obligatoire manquante: ${column}`, 1, column));
    }
  });

  if (errors.some((item) => item.code === 'REQUIRED_COLUMN_MISSING')) {
    return { validRows: [], warnings, errors, input: null };
  }

  rows.forEach((row) => {
    const rowErrors: PlanningImportDiagnostic[] = [];
    const categoryKey = normalizePlanningToken(row.category);
    const nameKey = normalizePlanningToken(row.name);

    if (!row.category) rowErrors.push(error('EMPTY_CATEGORY', `Ligne ${row.sourceRow}: catégorie manquante`, row.sourceRow, 'category'));
    if (!row.seed) rowErrors.push(error('EMPTY_SEED', `Ligne ${row.sourceRow}: seed manquant`, row.sourceRow, 'seed'));
    if (!row.name) rowErrors.push(error('EMPTY_NAME', `Ligne ${row.sourceRow}: nom manquant`, row.sourceRow, 'name'));

    const seed = Number(row.seed);
    if (row.seed && (!Number.isInteger(seed) || seed <= 0)) {
      rowErrors.push(error('INVALID_SEED', `Ligne ${row.sourceRow}: seed invalide (${row.seed})`, row.sourceRow, 'seed'));
    }

    if (rowErrors.length === 0) {
      const categorySeeds = seeds.get(categoryKey) ?? new Map<number, number>();
      const priorSeedRow = categorySeeds.get(seed);
      if (priorSeedRow !== undefined) {
        rowErrors.push(error(
          'DUPLICATE_SEED',
          `Ligne ${row.sourceRow}: seed ${seed} déjà utilisé dans ${categoryLabels.get(categoryKey) ?? row.category} (ligne ${priorSeedRow})`,
          row.sourceRow, 'seed',
        ));
      }

      const licenseKey = normalizePlanningToken(row.license);
      if (licenseKey) {
        const priorLicenseRow = licenses.get(licenseKey);
        if (priorLicenseRow !== undefined) {
          rowErrors.push(error(
            'DUPLICATE_PARTICIPANT',
            `Ligne ${row.sourceRow}: licence ${row.license} déjà utilisée (ligne ${priorLicenseRow})`,
            row.sourceRow, 'license',
          ));
        }
      } else if (nameKey && rowErrors.length === 0) {
        const participantKey = `${categoryKey}\u0000${nameKey}`;
        const priorNameRow = unlicensedNames.get(participantKey);
        if (priorNameRow !== undefined) {
          warnings.push(warning(
            'DUPLICATE_PARTICIPANT',
            `Ligne ${row.sourceRow}: nom sans licence déjà présent dans cette catégorie (ligne ${priorNameRow})`,
            row.sourceRow, 'name',
          ));
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    const displayCategory = categoryLabels.get(categoryKey) ?? row.category;
    if (!categoryLabels.has(categoryKey)) categoryLabels.set(categoryKey, row.category);
    const categorySeeds = seeds.get(categoryKey) ?? new Map<number, number>();
    categorySeeds.set(seed, row.sourceRow);
    seeds.set(categoryKey, categorySeeds);
    const licenseKey = normalizePlanningToken(row.license);
    if (licenseKey) licenses.set(licenseKey, row.sourceRow);
    else if (nameKey) unlicensedNames.set(`${categoryKey}\u0000${nameKey}`, row.sourceRow);
    validRows.push({
      category: displayCategory,
      seed,
      name: row.name,
      country: row.country || null,
      license: row.license || null,
      sourceRow: row.sourceRow,
    });
  });

  validRows.sort((left, right) => {
    const categoryOrder = normalizePlanningToken(left.category).localeCompare(normalizePlanningToken(right.category));
    return categoryOrder || left.seed - right.seed || left.sourceRow - right.sourceRow;
  });

  return {
    validRows,
    warnings,
    errors,
    input: errors.length === 0 ? {
      eventId: options.eventId ?? '',
      participants: validRows,
      source: options.source,
      sourceName: options.sourceName ?? null,
    } : null,
  };
};
