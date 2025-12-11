import type { AppConfig, HeatTimer } from '../types';

export const DIVISIONS = [
  'LONGBOARD HOMMES',
  'LONGBOARD FEMMES',
  'SHORTBOARD HOMMES',
  'SHORTBOARD FEMMES',
  'JUNIOR HOMMES',
  'JUNIOR FEMMES',
  'CADET HOMMES',
  'CADET FEMMES',
  'MINIME HOMMES',
  'MINIME FEMMES',
  'BENJAMIN HOMMES',
  'BENJAMIN FEMMES'
];

export const SURFER_COLORS: { [key: string]: string } = {
  'ROUGE': '#ef4444',
  'BLANC': '#f8fafc',
  'JAUNE': '#eab308',
  'BLEU': '#3b82f6',
  'VERT': '#22c55e',
  'NOIR': '#1f2937'
};

export const DEFAULT_TIMER_DURATION = 20; // minutes

export const DEFAULT_TIMER_STATE: HeatTimer = {
  isRunning: false,
  startTime: null,
  duration: DEFAULT_TIMER_DURATION
};

export const HEAT_RESULTS_CACHE_KEY = 'surfJudgingHeatResults';
export const HEAT_COLOR_CACHE_KEY = 'surfJudgingHeatColorMap';

export const INITIAL_CONFIG: AppConfig = {
  competition: '',
  division: '',
  round: 1,
  heatId: 1,
  judges: ['J1', 'J2', 'J3'],
  surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
  waves: 15,
  judgeNames: {},
  judgeEmails: {},
  surferNames: {},
  surferCountries: {},
  tournamentType: 'elimination',
  totalSurfers: 32,
  surfersPerHeat: 4,
  totalHeats: 8,
  totalRounds: 4
};

