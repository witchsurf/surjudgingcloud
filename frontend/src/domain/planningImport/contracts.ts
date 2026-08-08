export type PlanningImportSource = 'xlsx' | 'csv' | 'google_sheets' | 'manual';

export interface PlanningImportParticipant {
  category: string;
  seed: number;
  name: string;
  country: string | null;
  license: string | null;
  sourceRow: number;
}

export interface CanonicalPlanningInput {
  eventId: string;
  participants: readonly PlanningImportParticipant[];
  source: PlanningImportSource;
  sourceName: string | null;
}

export type PlanningImportDiagnosticSeverity = 'warning' | 'error';

export type PlanningImportDiagnosticCode =
  | 'EMPTY_FILE'
  | 'HEADER_MISSING'
  | 'REQUIRED_COLUMN_MISSING'
  | 'EMPTY_CATEGORY'
  | 'EMPTY_SEED'
  | 'INVALID_SEED'
  | 'DUPLICATE_SEED'
  | 'EMPTY_NAME'
  | 'INVALID_ROW'
  | 'DUPLICATE_PARTICIPANT'
  | 'EMPTY_ROW'
  | 'CSV_PARSE_ERROR'
  | 'WORKSHEET_SELECTION_REQUIRED'
  | 'WORKSHEET_NOT_FOUND'
  | 'XLSX_PARSE_ERROR';

export interface PlanningImportDiagnostic {
  severity: PlanningImportDiagnosticSeverity;
  code: PlanningImportDiagnosticCode;
  message: string;
  sourceRow: number | null;
  column: 'category' | 'seed' | 'name' | 'country' | 'license' | null;
}

export interface PlanningImportParseResult {
  validRows: readonly PlanningImportParticipant[];
  warnings: readonly PlanningImportDiagnostic[];
  errors: readonly PlanningImportDiagnostic[];
  input: CanonicalPlanningInput | null;
}

export interface PlanningImportParseOptions {
  eventId?: string;
  source: PlanningImportSource;
  sourceName?: string | null;
}

export type CanonicalPlanningColumn = 'category' | 'seed' | 'name' | 'country' | 'license';

export interface NeutralPlanningRow {
  sourceRow: number;
  cells: readonly string[];
}

export interface NormalizedPlanningRow {
  sourceRow: number;
  category: string;
  seed: string;
  name: string;
  country: string;
  license: string;
}
