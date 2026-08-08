import type { PanelContext } from '../../domain/scoring/panelContext';

export type RuntimePanelSnapshots = ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>>;

export interface JudgeAssignment {
  heatId: string | null;
  eventId: number | null;
  station: string;
  judgeId: string;
  judgeName: string;
  assignedAt?: string | null;
  updatedAt?: string | null;
}

export interface PodiumJudgePanel {
  eventId: number;
  podiumId: string;
  assignments: readonly JudgeAssignment[];
}

export interface SetPodiumPanelRequest {
  eventId: number;
  podiumId: string;
  heatId?: string | null;
  assignedBy?: string;
  assignments: readonly Pick<JudgeAssignment, 'station' | 'judgeId' | 'judgeName'>[];
}

export interface PanelRepositoryContract {
  resolveContexts(
    heatIds: readonly string[],
    runtimeSnapshots?: RuntimePanelSnapshots,
  ): Promise<ReadonlyMap<string, PanelContext>>;
  resolveContext(heatId: string, runtimeStations?: readonly string[]): Promise<PanelContext>;
  listHeatAssignments(heatId: string): Promise<readonly JudgeAssignment[]>;
  listEventAssignments(eventId: number): Promise<readonly JudgeAssignment[]>;
  getPodiumPanel(eventId: number, podiumId: string): Promise<PodiumJudgePanel | null>;
  setPodiumPanel(request: SetPodiumPanelRequest): Promise<void>;
}
