import type { EffectiveInterference, InterferenceCall, Score } from '../../types';
import { computeEffectiveInterferences } from '../../utils/interference';
import { getCachedPanelContexts, type PanelContextLoader } from './panelContextCache';
import type { HeatResultSnapshot } from './contracts';
import { resolveConsumerHeatSnapshot, type OverlayScoringIssue } from './overlaySnapshot';

export interface CanonicalHeatSnapshotRequest {
  heatId: string;
  scores: readonly Score[];
  surfers: readonly string[];
  maxWaves: number;
  judgeStations?: readonly string[];
  interferenceCalls?: readonly InterferenceCall[];
  effectiveInterferences?: readonly EffectiveInterference[];
}

export interface CanonicalHeatSnapshotFailure {
  heatId: string;
  issue: OverlayScoringIssue;
  message: string;
}

export interface CanonicalHeatSnapshotBatch {
  snapshots: Map<string, HeatResultSnapshot>;
  failures: CanonicalHeatSnapshotFailure[];
}

export class CanonicalHeatSnapshotUnavailableError extends Error {
  constructor(public readonly failures: readonly CanonicalHeatSnapshotFailure[]) {
    super(`Résultat canonique indisponible : ${failures.map((failure) => `${failure.heatId} (${failure.message})`).join(' ; ')}`);
    this.name = 'CanonicalHeatSnapshotUnavailableError';
  }
}

export async function buildCanonicalHeatSnapshots(
  requests: readonly CanonicalHeatSnapshotRequest[],
  panelContextLoader: PanelContextLoader,
): Promise<CanonicalHeatSnapshotBatch> {
  const scoredRequests = requests.filter((request) => request.heatId && request.scores.length > 0);
  const runtimeSnapshots = new Map<string, readonly string[]>();
  scoredRequests.forEach((request) => {
    if (request.judgeStations?.length) runtimeSnapshots.set(request.heatId, request.judgeStations);
  });
  const panelContexts = await getCachedPanelContexts(
    scoredRequests.map((request) => request.heatId),
    runtimeSnapshots,
    panelContextLoader,
  );
  const snapshots = new Map<string, HeatResultSnapshot>();
  const failures: CanonicalHeatSnapshotFailure[] = [];

  scoredRequests.forEach((request) => {
    const panelContext = panelContexts.get(request.heatId);
    if (!panelContext) {
      failures.push({ heatId: request.heatId, issue: 'panel_unknown', message: 'Panel inconnu : contexte absent.' });
      return;
    }
    const effectiveInterferences = request.effectiveInterferences || (
      panelContext.judgeCount
        ? computeEffectiveInterferences([...(request.interferenceCalls || [])], panelContext.judgeCount)
        : []
    );
    const state = resolveConsumerHeatSnapshot({
      heatId: request.heatId,
      config: {
        judges: request.judgeStations ? [...request.judgeStations] : [],
        surfers: [...request.surfers],
        waves: request.maxWaves,
      },
      scores: request.scores,
      panelContext,
      effectiveInterferences,
    });
    if (!state.snapshot) {
      failures.push({
        heatId: request.heatId,
        issue: state.issue || 'shadow_divergence',
        message: state.message || 'Résultat shadow indisponible.',
      });
      return;
    }
    snapshots.set(request.heatId, state.snapshot);
  });

  return { snapshots, failures };
}

export async function requireCanonicalHeatSnapshots(
  requests: readonly CanonicalHeatSnapshotRequest[],
  panelContextLoader: PanelContextLoader,
): Promise<Map<string, HeatResultSnapshot>> {
  const result = await buildCanonicalHeatSnapshots(requests, panelContextLoader);
  if (result.failures.length > 0) throw new CanonicalHeatSnapshotUnavailableError(result.failures);
  return result.snapshots;
}
