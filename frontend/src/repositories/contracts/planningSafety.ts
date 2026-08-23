export type PlanningSafetyState = 'SAFE' | 'BLOCKED';

export interface PlanningSafetyHeatInventory {
  heatId: string;
  status: string;
  isActive: boolean;
  scoreCount: number;
  overrideCount: number;
  interferenceCount: number;
  judgeAssignmentCount: number;
  timerCount: number;
  historyCount: number;
  activePointerCount: number;
  blockerReasons: readonly string[];
}

export interface PlanningSafetyPreflightRequest {
  eventId: number;
  category: string;
  proposedHeatIds: readonly string[];
  overwrite: boolean;
}

export interface PlanningSafetyPreflightResult {
  state: PlanningSafetyState;
  targetedHeats: readonly PlanningSafetyHeatInventory[];
}

export interface SafePlanningPersistenceRequest extends PlanningSafetyPreflightRequest {
  heats: readonly Record<string, unknown>[];
  entries: readonly Record<string, unknown>[];
  mappings: readonly Record<string, unknown>[];
  participants: readonly Record<string, unknown>[];
  heatConfigs: readonly Record<string, unknown>[];
  progressionEdges?: readonly Record<string, unknown>[];
  policies?: readonly Record<string, unknown>[];
}

export interface PlanningSafetyRepositoryContract {
  preflight(request: PlanningSafetyPreflightRequest): Promise<PlanningSafetyPreflightResult>;
  persistSafePlanning(request: SafePlanningPersistenceRequest): Promise<void>;
}
