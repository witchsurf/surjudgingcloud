import type { Tables, TablesInsert, TablesUpdate } from './supabase.generated';

export type ScoreRow = Tables<'scores'>;
export type ScoreInsert = TablesInsert<'scores'>;
export type ScoreUpdate = TablesUpdate<'scores'>;
export type ScoreOverrideRow = Tables<'score_overrides'>;
export type ScoreDeletionRow = Tables<'score_deletions'>;
export type InterferenceCallRow = Tables<'interference_calls'>;
export type HeatRow = Tables<'heats'>;
export type HeatEntryRow = Tables<'heat_entries'>;
export type HeatConfigRow = Tables<'heat_configs'>;
export type HeatJudgeAssignmentRow = Tables<'heat_judge_assignments'>;
export type EventRow = Tables<'events'>;
export type ParticipantRow = Tables<'participants'>;
export type JudgeRow = Tables<'judges'>;
