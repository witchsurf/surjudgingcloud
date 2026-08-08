import type { AppConfig, EffectiveInterference, Score } from '../../types';
import type { HeatResultSnapshot } from './contracts';
import type { PanelContext, PanelContextIssue } from './panelContext';
import { calculateShadowHeatResult, type ScoringOperatorIssue } from './shadow';

export type OverlayScoringIssue = PanelContextIssue | ScoringOperatorIssue;

export interface OverlayScoringState {
  snapshot: HeatResultSnapshot | null;
  issue: OverlayScoringIssue | null;
  message: string | null;
}

export interface ResolveOverlaySnapshotInput {
  heatId: string;
  config: Pick<AppConfig, 'judges' | 'surfers' | 'waves'>;
  scores: readonly Score[];
  panelContext: PanelContext;
  effectiveInterferences?: readonly EffectiveInterference[];
}

export function resolveConsumerHeatSnapshot(input: ResolveOverlaySnapshotInput): OverlayScoringState {
  if (!input.panelContext.judgeCount) {
    return {
      snapshot: null,
      issue: input.panelContext.issue || 'panel_unknown',
      message: input.panelContext.message || 'Panel inconnu : calcul P2 désactivé.',
    };
  }

  const shadow = calculateShadowHeatResult({
    heatId: input.heatId,
    scores: input.scores,
    surfers: input.config.surfers,
    judgeCount: input.panelContext.judgeCount,
    judgeStations: input.config.judges.length === input.panelContext.judgeCount
      ? input.config.judges
      : undefined,
    maxWaves: input.config.waves,
    effectiveInterferences: input.effectiveInterferences,
  });

  if (shadow.source !== 'p2' || !shadow.parity || !shadow.snapshot) {
    return { snapshot: null, issue: shadow.issue, message: shadow.message };
  }
  return { snapshot: shadow.snapshot, issue: null, message: null };
}

export const resolveOverlaySnapshot = resolveConsumerHeatSnapshot;
