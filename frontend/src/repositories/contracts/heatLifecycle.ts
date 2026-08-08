export interface ActivateHeatRequest {
  eventId: number;
  podiumId?: string | null;
  heatId: string;
  assignedBy?: string;
}

export interface ActivateHeatResult {
  eventId: number;
  podiumId: string;
  heatId: string;
  division?: string;
  round?: number;
  heatNumber?: number;
  panelSize?: number;
}

export interface HeatLifecycleRepositoryContract {
  activate(request: ActivateHeatRequest): Promise<ActivateHeatResult>;
  close(request: CloseHeatRequest): Promise<CloseHeatResult>;
}

export interface CloseHeatRequest {
  eventId: number;
  podiumId?: string | null;
  heatId: string;
  nextHeatId?: string | null;
  closedBy?: string;
  force?: boolean;
  forceReason?: string | null;
}

export interface CloseHeatResult {
  eventId: number;
  podiumId: string;
  closedHeatId: string;
  forced?: boolean;
  readiness?: unknown;
  qualifierSlotsUpdated: number;
  divisionSlotsRebuilt: number;
  next?: unknown;
}
