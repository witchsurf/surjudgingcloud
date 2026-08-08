import readXlsxFile from 'read-excel-file/universal';
import type {
  NeutralPlanningRow,
  PlanningImportDiagnostic,
  PlanningImportParseResult,
} from '../../domain/planningImport/contracts';
import { normalizePlanningHeaders, normalizePlanningToken } from '../../domain/planningImport/normalizeHeaders';
import { normalizePlanningRows } from '../../domain/planningImport/normalizeRows';
import { validatePlanningRows } from '../../domain/planningImport/validate';

export interface ParsePlanningXlsxOptions {
  eventId?: string;
  workbookName: string;
  worksheetName?: string | null;
}

export interface PlanningXlsxMetadata {
  workbookName: string;
  worksheetName: string | null;
  availableWorksheets: readonly string[];
}

export interface PlanningXlsxParseResult extends PlanningImportParseResult {
  metadata: PlanningXlsxMetadata;
}

const failed = (
  metadata: PlanningXlsxMetadata,
  diagnostic: PlanningImportDiagnostic,
): PlanningXlsxParseResult => ({ validRows: [], warnings: [], errors: [diagnostic], input: null, metadata });

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

export async function parsePlanningXlsx(
  input: File | Blob | ArrayBuffer,
  options: ParsePlanningXlsxOptions,
): Promise<PlanningXlsxParseResult> {
  let workbook;
  try {
    workbook = await readXlsxFile(input);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return failed(
      { workbookName: options.workbookName, worksheetName: null, availableWorksheets: [] },
      { severity: 'error', code: 'XLSX_PARSE_ERROR', message, sourceRow: null, column: null },
    );
  }

  const availableWorksheets = workbook.map((sheet) => sheet.sheet);
  const metadataBase = { workbookName: options.workbookName, availableWorksheets };
  const requested = options.worksheetName?.trim();
  const participantsSheet = workbook.find((sheet) => normalizePlanningToken(sheet.sheet) === 'participants');
  const selected = requested
    ? workbook.find((sheet) => normalizePlanningToken(sheet.sheet) === normalizePlanningToken(requested))
    : participantsSheet ?? (workbook.length === 1 ? workbook[0] : undefined);

  if (!selected) {
    const requestedMissing = Boolean(requested);
    return failed(
      { ...metadataBase, worksheetName: null },
      {
        severity: 'error',
        code: requestedMissing ? 'WORKSHEET_NOT_FOUND' : 'WORKSHEET_SELECTION_REQUIRED',
        message: requestedMissing
          ? `Onglet introuvable: ${requested}`
          : 'Plusieurs onglets disponibles : une sélection opérateur est requise',
        sourceRow: null,
        column: null,
      },
    );
  }

  const matrix = selected.data.map((row) => row.map(cellText));
  while (matrix.length > 1 && matrix.at(-1)?.every((cell) => !cell.trim())) matrix.pop();
  const metadata = { ...metadataBase, worksheetName: selected.sheet };
  if (matrix.length === 0 || matrix.every((row) => row.every((cell) => !cell.trim()))) {
    return failed(metadata, {
      severity: 'error', code: 'EMPTY_FILE', message: 'Classeur ou onglet vide', sourceRow: null, column: null,
    });
  }

  const headerCells = matrix[0] ?? [];
  if (headerCells.every((cell) => !cell.trim())) {
    return failed(metadata, {
      severity: 'error', code: 'HEADER_MISSING', message: 'En-tête XLSX absent', sourceRow: 1, column: null,
    });
  }

  const headers = normalizePlanningHeaders(headerCells);
  const neutralRows: NeutralPlanningRow[] = matrix.slice(1).map((cells, index) => ({ sourceRow: index + 2, cells }));
  const normalized = normalizePlanningRows(neutralRows, headers);
  const result = validatePlanningRows({
    rows: normalized.rows,
    headers,
    options: { eventId: options.eventId, source: 'xlsx', sourceName: options.workbookName },
    warnings: normalized.warnings,
    errors: normalized.errors,
  });
  return { ...result, metadata };
}
