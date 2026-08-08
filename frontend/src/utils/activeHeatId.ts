import { ensureHeatId } from './heat';

const KNOWN_DIVISION_ID_SUFFIXES = [
  'ondine_open',
  'girls_open',
  'ondine_u16',
  'benjamin',
  'minime',
  'cadet',
  'junior',
  'open',
];

export function parseActiveHeatId(heatId: string): { competition: string; division: string; round: number; heatNumber: number } | null {
  const match = ensureHeatId(heatId).match(/^(.+)_r(\d+)_h(\d+)$/i);
  if (!match) return null;
  const prefix = match[1];
  const round = parseInt(match[2], 10);
  const heatNumber = parseInt(match[3], 10);
  const divisionSuffix = KNOWN_DIVISION_ID_SUFFIXES.find((suffix) =>
    prefix === suffix || prefix.endsWith(`_${suffix}`)
  );
  const rawDivision = divisionSuffix ?? prefix.split('_').pop() ?? '';
  const competitionPrefix = divisionSuffix && prefix.endsWith(`_${divisionSuffix}`)
    ? prefix.slice(0, -(divisionSuffix.length + 1))
    : prefix.slice(0, Math.max(0, prefix.length - rawDivision.length)).replace(/_$/, '');
  const competition = (competitionPrefix || prefix).replace(/_/g, ' ').toUpperCase();
  const division = rawDivision.replace(/_/g, ' ').toUpperCase();
  return { competition, division: division.toUpperCase(), round, heatNumber };
}
