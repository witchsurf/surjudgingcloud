import type { RoundSpec } from '../../utils/bracket';
import type { ParticipantRecord } from './participants';

export interface HeatPlanningOptions {
  overwrite?: boolean;
  repechage?: RoundSpec[];
  defaultJudges?: string[];
  tournamentType?: string;
}

export interface CreateHeatPlanRequest {
  eventId: number;
  eventName: string;
  category: string;
  rounds: RoundSpec[];
  participantsBySeed: Map<number, ParticipantRecord>;
  options?: HeatPlanningOptions;
}

export interface PlannedHeatRecord {
  id: string;
  eventId: number;
  competition: string;
  division: string;
  round: number;
  heatNumber: number;
  heatSize: number;
  status: string;
  colorOrder: readonly string[];
}

export interface PlannedHeatEntryRecord {
  heatId: string;
  participantId: number | null;
  position: number;
  seed: number | null;
  color: string | null;
}

export interface CreateHeatPlanResult {
  heats: readonly PlannedHeatRecord[];
  entries: readonly PlannedHeatEntryRecord[];
}

export interface DeletePlannedHeatsRequest {
  eventId: number;
  category: string;
}

export interface HeatPlanningRepositoryContract {
  createWithEntries(request: CreateHeatPlanRequest): Promise<CreateHeatPlanResult>;
  deletePlanned(request: DeletePlannedHeatsRequest): Promise<void>;
}
