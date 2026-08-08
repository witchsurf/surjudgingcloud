export interface EventSummary {
  id: number;
  name: string;
  organizer: string | null;
  startDate: string | null;
  endDate: string | null;
  categories: readonly string[];
}

export interface EventJudgeSnapshot {
  id: string;
  name?: string;
  identityId?: string;
}

export interface EventConfigSnapshot {
  eventId: number;
  eventName: string;
  division: string;
  round: number;
  heatNumber: number;
  judges: readonly EventJudgeSnapshot[];
  surfers: readonly string[];
  heatSize?: number;
  surferNames: Readonly<Record<string, string>>;
  surferCountries: Readonly<Record<string, string>>;
  eventDetails?: {
    name?: string;
    organizer?: string;
    date?: string;
  };
  updatedAt: string;
}

export interface SaveEventSnapshotRequest extends Omit<EventConfigSnapshot, 'updatedAt' | 'heatSize' | 'eventDetails'> {}

export interface EventConfigurationUpdate {
  eventId: number;
  eventName: string;
  divisions: readonly string[];
  judges: readonly EventJudgeSnapshot[];
  config: Readonly<Record<string, unknown>>;
}

export interface EventRepositoryContract {
  list(): Promise<readonly EventSummary[]>;
  getById(eventId: number): Promise<EventSummary | null>;
  getIdByName(name: string): Promise<number | null>;
  ensureExists(name: string): Promise<number>;
  listDivisions(eventId?: number): Promise<readonly string[]>;
  getConfigurationSnapshot(eventId: number): Promise<EventConfigSnapshot | null>;
  saveConfigurationSnapshot(request: SaveEventSnapshotRequest): Promise<void>;
  updateConfiguration(request: EventConfigurationUpdate): Promise<void>;
}
