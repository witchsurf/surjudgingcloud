import {
  createHeatsWithEntries,
  deletePlannedHeats,
} from '../api/modules/heats.api';
import type {
  CreateHeatPlanRequest,
  CreateHeatPlanResult,
  HeatPlanningRepositoryContract,
  PlannedHeatEntryRecord,
  PlannedHeatRecord,
} from './contracts';
import { planningSafetyRepository } from './PlanningSafetyRepository';

const toPlannedHeat = (row: Awaited<ReturnType<typeof createHeatsWithEntries>>['heats'][number]): PlannedHeatRecord => ({
  id: row.id,
  eventId: row.event_id,
  competition: row.competition,
  division: row.division,
  round: row.round,
  heatNumber: row.heat_number,
  heatSize: row.heat_size,
  status: row.status,
  colorOrder: row.color_order,
});

const toPlannedEntry = (row: Awaited<ReturnType<typeof createHeatsWithEntries>>['entries'][number]): PlannedHeatEntryRecord => ({
  heatId: row.heat_id,
  participantId: row.participant_id,
  position: row.position,
  seed: row.seed,
  color: row.color,
});

export class HeatPlanningRepository implements HeatPlanningRepositoryContract {
  async createWithEntries(request: CreateHeatPlanRequest): Promise<CreateHeatPlanResult> {
    const result = await createHeatsWithEntries(
      request.eventId,
      request.eventName,
      request.category,
      request.rounds,
      request.participantsBySeed,
      request.options,
      (safeRequest) => planningSafetyRepository.persistSafePlanning(safeRequest),
    );

    return {
      heats: result.heats.map(toPlannedHeat),
      entries: result.entries.map(toPlannedEntry),
    };
  }

  deletePlanned(request: { eventId: number; category: string }): Promise<void> {
    // Explicit rollback-only compatibility surface. Modern generation uses createWithEntries.
    return deletePlannedHeats(request.eventId, request.category);
  }
}

export const heatPlanningRepository = new HeatPlanningRepository();
