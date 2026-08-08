export interface ParticipantRecord {
  id: number;
  eventId: number;
  category: string;
  seed: number;
  name: string;
  country: string | null;
  license: string | null;
}

export interface ParticipantInput {
  category: string;
  seed: number;
  name: string;
  country?: string | null;
  license?: string | null;
}

export type ParticipantPatch = Partial<ParticipantInput>;

export interface ParticipantRepositoryContract {
  listByEvent(eventId: number): Promise<readonly ParticipantRecord[]>;
  upsertMany(eventId: number, rows: readonly ParticipantInput[]): Promise<void>;
  update(id: number, patch: ParticipantPatch): Promise<void>;
  delete(id: number): Promise<void>;
}
