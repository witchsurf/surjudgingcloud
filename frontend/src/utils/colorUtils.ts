export type HeatColor = 'RED' | 'WHITE' | 'YELLOW' | 'BLUE' | 'GREEN' | 'BLACK' | 'ROUGE' | 'BLANC' | 'JAUNE' | 'BLEU' | 'VERT' | 'NOIR';

const COLOR_SETS: Record<number, HeatColor[]> = {
  2: ['RED', 'WHITE'],
  3: ['RED', 'WHITE', 'YELLOW'],
  4: ['RED', 'WHITE', 'YELLOW', 'BLUE'],
  5: ['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN'],
  6: ['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK'],
};

export const getColorSet = (heatSize: number): HeatColor[] => {
  if (heatSize in COLOR_SETS) {
    return [...COLOR_SETS[heatSize]];
  }
  if (heatSize > 6) {
    return [...COLOR_SETS[6]];
  }
  return [];
};

export const colorLabelMap: Record<HeatColor, string> = {
  RED: 'ROUGE',
  WHITE: 'BLANC',
  YELLOW: 'JAUNE',
  BLUE: 'BLEU',
  GREEN: 'VERT',
  BLACK: 'NOIR',
  // French keys support (identity)
  ROUGE: 'ROUGE',
  BLANC: 'BLANC',
  JAUNE: 'JAUNE',
  BLEU: 'BLEU',
  VERT: 'VERT',
  NOIR: 'NOIR',
};

export const colorClassMap: Record<HeatColor, string> = {
  RED: 'text-red-400 border-red-400',
  WHITE: 'text-white border-gray-300',
  YELLOW: 'text-yellow-400 border-yellow-400',
  BLUE: 'text-blue-400 border-blue-400',
  GREEN: 'text-green-400 border-green-400',
  BLACK: 'text-gray-400 border-gray-500',
  // French keys support
  ROUGE: 'text-red-400 border-red-400',
  BLANC: 'text-white border-gray-300',
  JAUNE: 'text-yellow-400 border-yellow-400',
  BLEU: 'text-blue-400 border-blue-400',
  VERT: 'text-green-400 border-green-400',
  NOIR: 'text-gray-400 border-gray-500',
};

export const colorHexMap: Record<HeatColor, string> = {
  RED: '#ef4444',
  WHITE: '#f8fafc',
  YELLOW: '#eab308',
  BLUE: '#3b82f6',
  GREEN: '#22c55e',
  BLACK: '#1f2937',
  // French keys support
  ROUGE: '#ef4444',
  BLANC: '#f8fafc',
  JAUNE: '#eab308',
  BLEU: '#3b82f6',
  VERT: '#22c55e',
  NOIR: '#1f2937',
};

export const colorGradientMap: Record<HeatColor, string> = {
  RED: 'linear-gradient(90deg, rgba(239,68,68,0.8) 0%, rgba(127,29,29,0.9) 100%)',
  WHITE: 'linear-gradient(90deg, rgba(248,250,252,0.8) 0%, rgba(148,163,184,0.7) 100%)',
  YELLOW: 'linear-gradient(90deg, rgba(234,179,8,0.85) 0%, rgba(180,83,9,0.85) 100%)',
  BLUE: 'linear-gradient(90deg, rgba(59,130,246,0.8) 0%, rgba(30,64,175,0.9) 100%)',
  GREEN: 'linear-gradient(90deg, rgba(34,197,94,0.8) 0%, rgba(21,128,61,0.85) 100%)',
  BLACK: 'linear-gradient(90deg, rgba(17,24,39,0.9) 0%, rgba(30,41,59,0.9) 100%)',
  // French keys support
  ROUGE: 'linear-gradient(90deg, rgba(239,68,68,0.8) 0%, rgba(127,29,29,0.9) 100%)',
  BLANC: 'linear-gradient(90deg, rgba(248,250,252,0.8) 0%, rgba(148,163,184,0.7) 100%)',
  JAUNE: 'linear-gradient(90deg, rgba(234,179,8,0.85) 0%, rgba(180,83,9,0.85) 100%)',
  BLEU: 'linear-gradient(90deg, rgba(59,130,246,0.8) 0%, rgba(30,64,175,0.9) 100%)',
  VERT: 'linear-gradient(90deg, rgba(34,197,94,0.8) 0%, rgba(21,128,61,0.85) 100%)',
  NOIR: 'linear-gradient(90deg, rgba(17,24,39,0.9) 0%, rgba(30,41,59,0.9) 100%)',
};
