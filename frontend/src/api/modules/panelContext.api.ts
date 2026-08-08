import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { ensureHeatId } from '../../utils/heat';
import { resolvePanelContext, type PanelContext } from '../../domain/scoring/panelContext';

export type RuntimePanelSnapshots = ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>;

const networkErrorContext = (details: string): PanelContext => ({
  judgeCount: null,
  source: 'unknown',
  issue: 'network_error',
  message: `Erreur réseau de lecture du panel : ${details}`,
});

const runtimeJudgesFor = (snapshots: RuntimePanelSnapshots | undefined, heatId: string) => {
  if (!snapshots) return undefined;
  return snapshots instanceof Map ? snapshots.get(heatId) : snapshots[heatId];
};

export async function fetchPanelContexts(
  heatIds: readonly string[],
  runtimeSnapshots?: RuntimePanelSnapshots,
): Promise<Map<string, PanelContext>> {
  const normalizedIds = Array.from(new Set(heatIds.map(ensureHeatId).filter(Boolean)));
  if (normalizedIds.length === 0) return new Map();

  if (!supabase || !isSupabaseConfigured()) {
    return new Map(normalizedIds.map((heatId) => [
      heatId,
      resolvePanelContext({ runtimeSnapshotJudges: runtimeJudgesFor(runtimeSnapshots, heatId) }),
    ]));
  }

  const [configResult, assignmentsResult] = await Promise.all([
    supabase.from('heat_configs').select('heat_id, judges').in('heat_id', normalizedIds),
    supabase.from('heat_judge_assignments').select('heat_id, station, judge_id').in('heat_id', normalizedIds).order('station'),
  ]);

  const readErrors = [
    configResult.error ? `heat_configs (${configResult.error.message})` : null,
    assignmentsResult.error ? `heat_judge_assignments (${assignmentsResult.error.message})` : null,
  ].filter(Boolean) as string[];

  if (readErrors.length > 0) {
    console.error('[P2 panel context network error]', { heatIds: normalizedIds, errors: readErrors });
    const context = networkErrorContext(readErrors.join(' ; '));
    return new Map(normalizedIds.map((heatId) => [heatId, context]));
  }

  const configs = new Map((configResult.data || []).map((row) => [row.heat_id, row.judges]));
  const assignments = (assignmentsResult.data || []).reduce<Map<string, Array<{ station: string; judgeId: string }>>>((map, row) => {
    const rows = map.get(row.heat_id) || [];
    rows.push({ station: row.station, judgeId: row.judge_id });
    map.set(row.heat_id, rows);
    return map;
  }, new Map());

  return new Map(normalizedIds.map((heatId) => [heatId, resolvePanelContext({
    heatConfigJudges: configs.get(heatId),
    assignments: assignments.get(heatId),
    runtimeSnapshotJudges: runtimeJudgesFor(runtimeSnapshots, heatId),
  })]));
}

export async function fetchPanelContext(
  heatId: string,
  runtimeSnapshotJudges?: readonly string[] | null,
): Promise<PanelContext> {
  const normalizedHeatId = ensureHeatId(heatId);
  const contexts = await fetchPanelContexts(
    [normalizedHeatId],
    runtimeSnapshotJudges ? { [normalizedHeatId]: runtimeSnapshotJudges } : undefined,
  );
  return contexts.get(normalizedHeatId) || resolvePanelContext({ runtimeSnapshotJudges });
}
