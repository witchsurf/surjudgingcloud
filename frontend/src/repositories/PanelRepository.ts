import { BaseRepository } from './BaseRepository';
import type {
  JudgeAssignment,
  PanelRepositoryContract,
  PodiumJudgePanel,
  RuntimePanelSnapshots,
  SetPodiumPanelRequest,
} from './contracts';
import { fetchPanelContext, fetchPanelContexts } from '../api/modules/panelContext.api';
import {
  fetchEventJudgeAssignments,
  fetchHeatJudgeAssignments,
  fetchPodiumJudgePanel,
  setPodiumJudgePanel,
  type HeatJudgeAssignmentRow,
} from '../api/modules/heats.api';

const toJudgeAssignment = (row: HeatJudgeAssignmentRow): JudgeAssignment => ({
  heatId: row.heat_id,
  eventId: row.event_id,
  station: row.station,
  judgeId: row.judge_id,
  judgeName: row.judge_name,
  assignedAt: row.assigned_at ?? null,
  updatedAt: row.updated_at ?? null,
});

export class PanelRepository extends BaseRepository implements PanelRepositoryContract {
  constructor() {
    super('heat_judge_assignments');
  }

  resolveContexts(heatIds: readonly string[], runtimeSnapshots?: RuntimePanelSnapshots) {
    return fetchPanelContexts(heatIds, runtimeSnapshots);
  }

  resolveContext(heatId: string, runtimeStations?: readonly string[]) {
    return fetchPanelContext(heatId, runtimeStations);
  }

  async listHeatAssignments(heatId: string): Promise<JudgeAssignment[]> {
    return (await fetchHeatJudgeAssignments(heatId)).map(toJudgeAssignment);
  }

  async listEventAssignments(eventId: number): Promise<JudgeAssignment[]> {
    return (await fetchEventJudgeAssignments(eventId)).map(toJudgeAssignment);
  }

  async getPodiumPanel(eventId: number, podiumId: string): Promise<PodiumJudgePanel | null> {
    const rows = await fetchPodiumJudgePanel(eventId, podiumId);
    if (rows.length === 0) return null;
    return {
      eventId,
      podiumId: podiumId.trim().toUpperCase() || 'A',
      assignments: rows.map((row) => ({
        heatId: null,
        eventId: row.event_id,
        station: row.station,
        judgeId: row.judge_id,
        judgeName: row.judge_name,
        updatedAt: row.updated_at ?? null,
      })),
    };
  }

  async setPodiumPanel(request: SetPodiumPanelRequest): Promise<void> {
    await setPodiumJudgePanel({
      eventId: request.eventId,
      podiumId: request.podiumId,
      assignments: request.assignments.map((assignment) => ({
        station: assignment.station,
        judgeId: assignment.judgeId,
        judgeName: assignment.judgeName,
      })),
      assignedBy: request.assignedBy,
    });
  }
}

export const panelRepository = new PanelRepository();
