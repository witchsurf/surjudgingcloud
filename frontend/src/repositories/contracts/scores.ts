import type { HeatSyncSummary, SyncSummary } from './common';

export type ScoreOverrideReason = 'correction' | 'omission' | 'probleme';
export type InterferenceType = 'INT1' | 'INT2';

export interface ScoreRecord {
  id?: string;
  eventId?: number;
  heatId: string;
  competition: string;
  division: string;
  round: number;
  judgeId: string;
  judgeName: string;
  judgeStation?: string;
  judgeIdentityId?: string;
  lycraColor: string;
  waveNumber: number;
  score: number;
  timestamp: string;
  createdAt?: string;
  synced?: boolean;
}

export interface ScoreOverrideLogRecord {
  id: string;
  heatId: string;
  scoreId: string;
  judgeId: string;
  judgeName: string;
  judgeStation?: string;
  judgeIdentityId?: string;
  lycraColor: string;
  waveNumber: number;
  previousScore: number | null;
  newScore: number;
  reason: ScoreOverrideReason;
  comment?: string;
  overriddenBy: string;
  overriddenByName: string;
  createdAt: string;
}

export interface InterferenceCallRecord {
  id?: string;
  eventId?: number | null;
  heatId: string;
  judgeId: string;
  judgeName?: string | null;
  judgeStation?: string | null;
  judgeIdentityId?: string | null;
  lycraColor: string;
  waveNumber: number;
  type: InterferenceType;
  headJudgeOverride?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EffectiveInterferenceRecord {
  lycraColor: string;
  waveNumber: number;
  type: InterferenceType;
  source: 'majority' | 'head_judge';
}

export interface SaveScoreRequest {
  heatId: string;
  competition: string;
  division: string;
  round: number;
  judgeId: string;
  judgeName: string;
  judgeStation?: string;
  judgeIdentityId?: string;
  lycraColor: string;
  waveNumber: number;
  score: number;
  eventId?: number | null;
}

export interface OverrideScoreRequest extends Omit<SaveScoreRequest, 'score' | 'eventId'> {
  newScore: number;
  reason: ScoreOverrideReason;
  comment?: string;
}

export interface OverrideScoreResult {
  updatedScore: ScoreRecord;
  previousScore?: ScoreRecord;
  log: ScoreOverrideLogRecord;
}

export interface ScoreCorrectionRequest {
  scoreId: string;
  newScore: number;
  reason: string;
  comment?: string;
  correctedBy?: string;
}

export interface ScoreRepositoryContract {
  save(request: SaveScoreRequest): Promise<ScoreRecord>;
  listByHeat(heatId: string, legacyHeatId?: string): Promise<readonly ScoreRecord[]>;
  override(request: OverrideScoreRequest): Promise<OverrideScoreResult>;
  listOverrideLogs(heatId: string): Promise<readonly ScoreOverrideLogRecord[]>;
  syncHeat(heatId: string): Promise<SyncSummary>;
  syncPending(): Promise<HeatSyncSummary>;
}

export interface ScoringReadRepositoryContract {
  listForHeats(heatIds: readonly string[]): Promise<Readonly<Record<string, readonly ScoreRecord[]>>>;
  listPreferredForEvent(eventId: number): Promise<Readonly<Record<string, readonly ScoreRecord[]>>>;
  listInterferences(heatId: string): Promise<readonly InterferenceCallRecord[]>;
  listInterferencesForEvent(eventId: number): Promise<Readonly<Record<string, readonly InterferenceCallRecord[]>>>;
  resolveEffectiveInterferences(heatId: string, judgeCount: 3 | 5): Promise<readonly EffectiveInterferenceRecord[]>;
}
