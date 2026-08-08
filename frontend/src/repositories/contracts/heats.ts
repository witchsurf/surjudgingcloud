export interface HeatSlotParticipant {
  id: number | null;
  name: string;
  country: string | null;
  license: string | null;
}

export interface HeatRoundRecord {
  roundNumber: number;
  roundName?: string;
  heats: readonly {
    heatId: string;
    heatNumber: number;
    slots: readonly HeatSlotRecord[];
  }[];
}

export interface HeatSlotRecord {
  position: number;
  color: string | null;
  seed: number | null;
  participantId: number | null;
  participant: HeatSlotParticipant | null;
  placeholder?: string | null;
  bye?: boolean;
}

export interface HeatRecord {
  id: string;
  eventId: number;
  competition: string;
  division: string;
  round: number;
  heatNumber: number;
  heatSize: number;
  status: string;
  colorOrder: readonly string[];
  slots: readonly HeatSlotRecord[];
}

export interface HeatSequenceEntry {
  id: string;
  round: number;
  heatNumber: number;
  status: string;
  heatSize: number | null;
  colorOrder: readonly string[] | null;
}

export interface HeatSlotMapping {
  heatId: string;
  position: number;
  placeholder: string | null;
  sourceRound: number | null;
  sourceHeat: number | null;
  sourcePosition: number | null;
}

export interface ReplaceHeatEntry {
  position: number;
  participantId: number | null;
  seed?: number | null;
  color?: string | null;
}

export interface HeatConfigurationRequest {
  eventId: number | null;
  judges: readonly string[];
  surfers: readonly string[];
  judgeNames?: Readonly<Record<string, string>>;
  judgeIdentities?: Readonly<Record<string, string>>;
  surferNames?: Readonly<Record<string, string>>;
  surferCountries?: Readonly<Record<string, string>>;
  waves?: number;
  tournamentType?: string;
  podiumId?: string | null;
}

export interface HeatEntryOverrideRequest {
  heatId: string;
  position: number;
  color?: string | null;
  participantId?: number | null;
  name?: string | null;
  country?: string | null;
  reason?: string | null;
  createdBy?: string | null;
}

export interface HeatEntryOverrideResult {
  heatId: string;
  position: number;
  color: string | null;
  participantId: number;
  name: string;
  country: string | null;
  configPatch?: unknown;
}

export interface HeatStartDependencyBlocker {
  position?: number | null;
  placeholder?: string | null;
  sourceRound?: number | null;
  sourceHeat?: number | null;
  sourcePosition?: number | null;
  sourceHeatId?: string | null;
  sourceStatus?: string | null;
  reason?: string | null;
  message?: string | null;
}

export interface HeatStartDependencyCheck {
  ok: boolean;
  heatId?: string | null;
  blockers: readonly HeatStartDependencyBlocker[];
}

export interface RuntimeHeatCreateRequest {
  id: string;
  eventId: number | null;
  competition?: string;
  division?: string;
  round: number;
  heatNumber: number;
  status?: string;
  createdAt: string;
}

export interface HeatRepositoryContract {
  getById(heatId: string): Promise<HeatRecord | null>;
  listSequence(eventId: number, division: string): Promise<readonly HeatSequenceEntry[]>;
  listCategoryRounds(eventId: number, division: string): Promise<readonly HeatRoundRecord[]>;
  listAllEventRounds(eventId: number): Promise<Readonly<Record<string, readonly HeatRoundRecord[]>>>;
  listEntries(heatId: string): Promise<readonly HeatSlotRecord[]>;
  listEntriesBatch(heatIds: readonly string[]): Promise<ReadonlyMap<string, readonly HeatSlotRecord[]>>;
  listSlotMappings(heatId: string): Promise<readonly HeatSlotMapping[]>;
  listSlotMappingsBatch(heatIds: readonly string[]): Promise<ReadonlyMap<string, readonly HeatSlotMapping[]>>;
  saveConfiguration(heatId: string, request: HeatConfigurationRequest): Promise<void>;
  replaceEntries(heatId: string, rows: readonly ReplaceHeatEntry[]): Promise<void>;
  overrideEntry(request: HeatEntryOverrideRequest): Promise<HeatEntryOverrideResult>;
  validateStartDependencies(heatId: string): Promise<HeatStartDependencyCheck>;
  createRuntime(request: RuntimeHeatCreateRequest): Promise<void>;
}
