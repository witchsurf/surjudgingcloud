import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json, SupabaseDatabase } from '../../types/supabaseDatabase';

export interface RuntimeHeatConfigPayload {
  heat_id: string;
  judges: readonly unknown[];
  surfers: readonly unknown[];
  judge_names: Readonly<Record<string, unknown>>;
  waves: number;
  tournament_type: string;
}

export async function upsertRuntimeHeatConfig(
  client: SupabaseClient<SupabaseDatabase>,
  payload: RuntimeHeatConfigPayload,
): Promise<void> {
  const { error } = await client.rpc('upsert_heat_config_runtime', {
    p_heat_id: payload.heat_id,
    p_judges: payload.judges.map((value) => String(value)),
    p_surfers: payload.surfers.map((value) => String(value)),
    p_judge_names: payload.judge_names as Json,
    p_waves: payload.waves,
    p_tournament_type: payload.tournament_type,
  });

  if (error) throw error;
}

export async function replayLegacyRuntimeHeatConfig(
  client: SupabaseClient<SupabaseDatabase>,
  legacyPayload: unknown,
): Promise<void> {
  const envelope = legacyPayload && typeof legacyPayload === 'object'
    ? legacyPayload as Record<string, unknown>
    : {};
  const candidate = envelope.rows && typeof envelope.rows === 'object'
    ? envelope.rows as Record<string, unknown>
    : envelope;

  await upsertRuntimeHeatConfig(client, {
    heat_id: String(candidate.heat_id ?? ''),
    judges: Array.isArray(candidate.judges) ? candidate.judges : [],
    surfers: Array.isArray(candidate.surfers) ? candidate.surfers : [],
    judge_names: candidate.judge_names && typeof candidate.judge_names === 'object'
      ? candidate.judge_names as Record<string, unknown>
      : {},
    waves: Number.isFinite(Number(candidate.waves)) ? Number(candidate.waves) : 15,
    tournament_type: typeof candidate.tournament_type === 'string'
      ? candidate.tournament_type
      : 'elimination',
  });
}
