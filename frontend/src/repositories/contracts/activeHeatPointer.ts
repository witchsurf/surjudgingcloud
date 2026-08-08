export interface ActiveHeatPointerRecord {
  eventId: number | null;
  eventName: string;
  podiumId: string | null;
  activeHeatId: string;
  updatedAt: string;
}

export interface ReadActiveHeatPointerRequest {
  eventId?: number | null;
  eventName?: string;
  podiumId?: string | null;
}

export interface WriteActiveHeatPointerRequest {
  eventId?: number | null;
  eventName: string;
  podiumId?: string | null;
  activeHeatId: string;
  updatedAt?: string;
}

export interface ActiveHeatPointerRepositoryContract {
  get(request?: ReadActiveHeatPointerRequest): Promise<ActiveHeatPointerRecord | null>;
  upsert(request: WriteActiveHeatPointerRequest): Promise<void>;
}
