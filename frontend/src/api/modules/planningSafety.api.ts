import { supabase } from '../../lib/supabase';
import type { SafePlanningPersistenceRequest } from '../../repositories/contracts';
import { ensureSupabase } from './core.api';

export interface PlanningSafetyInventoryRow {
  heat_id: string;
  status: string;
  is_active: boolean;
  score_count: number;
  override_count: number;
  interference_count: number;
  judge_assignment_count: number;
  timer_count: number;
  history_count: number;
  active_pointer_count: number;
  blocker_reasons: string[];
}

const count = (value: unknown, field: string): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Réponse preflight invalide: ${field}`);
  return parsed;
};

const parseInventoryRow = (value: unknown): PlanningSafetyInventoryRow => {
  if (!value || typeof value !== 'object') throw new Error('Réponse preflight invalide');
  const row = value as Record<string, unknown>;
  if (typeof row.heat_id !== 'string' || typeof row.status !== 'string' || typeof row.is_active !== 'boolean') {
    throw new Error('Réponse preflight invalide: heat');
  }
  if (!Array.isArray(row.blocker_reasons) || row.blocker_reasons.some((reason) => typeof reason !== 'string')) {
    throw new Error('Réponse preflight invalide: blocker_reasons');
  }
  return {
    heat_id: row.heat_id,
    status: row.status,
    is_active: row.is_active,
    score_count: count(row.score_count, 'score_count'),
    override_count: count(row.override_count, 'override_count'),
    interference_count: count(row.interference_count, 'interference_count'),
    judge_assignment_count: count(row.judge_assignment_count, 'judge_assignment_count'),
    timer_count: count(row.timer_count, 'timer_count'),
    history_count: count(row.history_count, 'history_count'),
    active_pointer_count: count(row.active_pointer_count, 'active_pointer_count'),
    blocker_reasons: [...row.blocker_reasons],
  };
};

export async function fetchPlanningSafetyInventory(input: {
  eventId: number;
  category: string;
  proposedHeatIds: readonly string[];
  overwrite: boolean;
}): Promise<PlanningSafetyInventoryRow[]> {
  ensureSupabase();
  const { data, error } = await supabase!.rpc('check_heat_planning_safety', {
    p_event_id: input.eventId,
    p_category: input.category,
    p_proposed_heat_ids: [...input.proposedHeatIds],
    p_overwrite: input.overwrite,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Réponse preflight invalide');
  return data.map(parseInventoryRow);
}

export async function persistSafePlanningRpc(input: SafePlanningPersistenceRequest): Promise<void> {
  ensureSupabase();
  if (input.progressionEdges?.length || input.policies?.length) {
    const { error } = await supabase!.rpc('bulk_upsert_heats_safe_v5', {
      p_event_id: input.eventId,
      p_category: input.category,
      p_overwrite: input.overwrite,
      p_heats: [...input.heats],
      p_entries: [...input.entries],
      p_mappings: [...input.mappings],
      p_participants: [...input.participants],
      p_heat_configs: [...input.heatConfigs],
      p_progression_edges: [...(input.progressionEdges ?? [])],
      p_policies: [...(input.policies ?? [])],
    });
    if (error) throw error;
  } else {
    const { error } = await supabase!.rpc('bulk_upsert_heats_safe_v2', {
      p_event_id: input.eventId,
      p_category: input.category,
      p_overwrite: input.overwrite,
      p_heats: [...input.heats],
      p_entries: [...input.entries],
      p_mappings: [...input.mappings],
      p_participants: [...input.participants],
      p_heat_configs: [...input.heatConfigs],
    });
    if (error) throw error;
  }
}
