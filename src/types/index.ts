export interface AppConfig {
  competition: string;
  division: string;
  round: number;
  heatId: number;
  judges: string[];
  surfers: string[];
  waves: number;
  judgeNames: Record<string, string>;
  tournamentType: 'elimination' | 'repechage';
  totalSurfers: number;
  surfersPerHeat: number;
  totalHeats: number;
  totalRounds: number;
}

export interface HeatTimer {
  isRunning: boolean;
  startTime: Date | null;
  duration: number; // en minutes
}

export interface Score {
  id?: string;
  heat_id: string;
  competition: string;
  division: string;
  round: number;
  judge_id: string;
  judge_name: string;
  surfer: string;
  wave_number: number;
  score: number;
  timestamp: string;
  created_at?: string;
  synced?: boolean;
}

export type OverrideReason = 'correction' | 'omission' | 'probleme';

export interface ScoreOverrideLog {
  id: string;
  heat_id: string;
  score_id: string;
  judge_id: string;
  judge_name: string;
  surfer: string;
  wave_number: number;
  previous_score: number | null;
  new_score: number;
  reason: OverrideReason;
  comment?: string;
  overridden_by: string;
  overridden_by_name: string;
  created_at: string;
}

export interface Heat {
  id: string;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  status: 'open' | 'closed';
  created_at: string;
  closed_at?: string;
}

export interface SurferScore {
  surfer: string;
  scores: number[];
  total: number;
  best2: number;
  rank: number;
}

export interface WaveScore {
  wave: number;
  score: number;
  judgeScores: Record<string, number>;
  isComplete: boolean;
}

export interface SurferStats {
  surfer: string;
  waves: WaveScore[];
  bestTwo: number;
  rank: number;
  color: string;
}
