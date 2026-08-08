export interface HeatSlotParticipant {
  id: number | null;
  name: string;
  country: string | null;
  license: string | null;
}

export interface HeatRow {
  id: string;
  event_id: number;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  heat_size: number;
  status: string;
  color_order: string[];
}

export interface HeatSequenceRow {
  id: string;
  round: number;
  heat_number: number;
  status: string;
  heat_size: number | null;
  color_order: string[] | null;
}

export interface HeatEntryJoinedRow {
  heat_id?: string;
  color: string | null;
  position: number;
  participant_id: number | null;
  seed: number | null;
  participant: HeatSlotParticipant | HeatSlotParticipant[] | null;
}

export interface LegacyLineupRow {
  heat_id?: string;
  jersey_color: string | null;
  position: number;
  surfer_name: string | null;
  country: string | null;
  seed: number | null;
}

export interface HeatSlotMapping {
  heat_id?: string;
  position: number;
  placeholder: string | null;
  source_round: number | null;
  source_heat: number | null;
  source_position: number | null;
}

export interface HeatWithEntriesRow {
  id: string;
  round: number;
  heat_number: number;
  heat_size: number | null;
  color_order: string[] | null;
  status: string;
  heat_entries: HeatEntryJoinedRow[];
  heat_slot_mappings: HeatSlotMapping[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableString = (value: unknown): string | null => typeof value === 'string' ? value : null;
const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const requiredNumber = (value: unknown, field: string): number => {
  const parsed = nullableNumber(value);
  if (parsed === null) throw new Error(`Réponse heat invalide: ${field}.`);
  return parsed;
};
const stringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null;

export function parseHeatSlotParticipant(value: unknown): HeatSlotParticipant | null {
  const source = Array.isArray(value) ? value[0] : value;
  const row = record(source);
  if (!row || typeof row.name !== 'string') return null;
  return {
    id: nullableNumber(row.id),
    name: row.name,
    country: nullableString(row.country),
    license: nullableString(row.license),
  };
}

export function parseHeatRow(value: unknown): HeatRow {
  const row = record(value);
  if (!row || typeof row.id !== 'string') throw new Error('Réponse metadata heat invalide.');
  return {
    id: row.id,
    event_id: requiredNumber(row.event_id, 'event_id'),
    competition: typeof row.competition === 'string' ? row.competition : '',
    division: typeof row.division === 'string' ? row.division : '',
    round: requiredNumber(row.round, 'round'),
    heat_number: requiredNumber(row.heat_number, 'heat_number'),
    heat_size: requiredNumber(row.heat_size, 'heat_size'),
    status: typeof row.status === 'string' ? row.status : 'open',
    color_order: stringArray(row.color_order) ?? [],
  };
}

export function parseHeatSequenceRow(value: unknown): HeatSequenceRow {
  const row = record(value);
  if (!row || typeof row.id !== 'string') throw new Error('Réponse séquence heat invalide.');
  return {
    id: row.id,
    round: requiredNumber(row.round, 'round'),
    heat_number: requiredNumber(row.heat_number, 'heat_number'),
    status: typeof row.status === 'string' ? row.status : 'open',
    heat_size: nullableNumber(row.heat_size),
    color_order: stringArray(row.color_order),
  };
}

export function parseHeatEntryJoinedRow(value: unknown): HeatEntryJoinedRow {
  const row = record(value);
  if (!row) throw new Error('Réponse heat_entries invalide.');
  return {
    heat_id: typeof row.heat_id === 'string' ? row.heat_id : undefined,
    color: nullableString(row.color),
    position: requiredNumber(row.position, 'position'),
    participant_id: nullableNumber(row.participant_id),
    seed: nullableNumber(row.seed),
    participant: parseHeatSlotParticipant(row.participant),
  };
}

export function parseLegacyLineupRow(value: unknown): LegacyLineupRow {
  const row = record(value);
  if (!row) throw new Error('Réponse v_heat_lineup invalide.');
  return {
    heat_id: typeof row.heat_id === 'string' ? row.heat_id : undefined,
    jersey_color: nullableString(row.jersey_color),
    position: requiredNumber(row.position, 'position'),
    surfer_name: nullableString(row.surfer_name),
    country: nullableString(row.country),
    seed: nullableNumber(row.seed),
  };
}

export function parseHeatSlotMapping(value: unknown): HeatSlotMapping {
  const row = record(value);
  if (!row) throw new Error('Réponse heat_slot_mappings invalide.');
  return {
    heat_id: typeof row.heat_id === 'string' ? row.heat_id : undefined,
    position: requiredNumber(row.position, 'position'),
    placeholder: nullableString(row.placeholder),
    source_round: nullableNumber(row.source_round),
    source_heat: nullableNumber(row.source_heat),
    source_position: nullableNumber(row.source_position),
  };
}

export function parseHeatWithEntriesRow(value: unknown): HeatWithEntriesRow {
  const row = record(value);
  if (!row || typeof row.id !== 'string') throw new Error('Réponse heat avec lineup invalide.');
  return {
    id: row.id,
    round: requiredNumber(row.round, 'round'),
    heat_number: requiredNumber(row.heat_number, 'heat_number'),
    heat_size: nullableNumber(row.heat_size),
    color_order: stringArray(row.color_order),
    status: typeof row.status === 'string' ? row.status : 'open',
    heat_entries: Array.isArray(row.heat_entries) ? row.heat_entries.map(parseHeatEntryJoinedRow) : [],
    heat_slot_mappings: Array.isArray(row.heat_slot_mappings) ? row.heat_slot_mappings.map(parseHeatSlotMapping) : [],
  };
}

export const parseRows = <T>(value: unknown, parser: (row: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(parser) : [];
