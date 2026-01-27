export interface AppConfig {
  competition: string;
  division: string;
  round: number;
  heatId: number;
  judges: string[];
  surfers: string[];
  waves: number;
  judgeNames: Record<string, string>;
  judgeEmails?: Record<string, string>;
  surferNames?: Record<string, string>;
  surferCountries: Record<string, string>;
  secretKey?: string;
  tournamentType?: 'elimination' | 'repechage';
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
  event_id?: number;
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
  id?: string;
  competition?: string;
  division?: string;
  round: number;
  heat_number: number;
  status?: 'open' | 'closed';
  created_at?: string;
  closed_at?: string;
  surfers: Array<{
    color: string;
    name: string;
    country: string;
    seed?: number | null;  // ✅ ADD SEED for participant matching
  }>;
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

export type PaymentProvider = 'orange_money' | 'wave' | 'stripe';

export interface EventRecord {
  id: number;
  name: string;
  organizer: string;
  start_date: string;
  end_date: string;
  price: number;
  currency: string;
  method: string | null;
  status: 'pending' | 'paid' | 'failed';
  paid: boolean;
  paid_at: string | null;
  payment_ref: string | null;
  categories: Record<string, unknown>[] | unknown[];
  judges: Record<string, unknown>[] | unknown[];
  user_id: string | null;
  created_at: string;
}

export interface PaymentRecord {
  id: number;
  event_id: number | null;
  user_id: string | null;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed';
  transaction_ref: string | null;
  paid_at: string | null;
  created_at: string;
}

// Export kiosk-related types
export * from './kiosk';
