export const normalizeHeatId = (raw: string | null | undefined): string => {
  if (!raw) return '';
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  // Canonical format already present: *_rX_hY
  const canonicalMatch = normalized.match(/^(.*)_r(\d+)_h(\d+)$/);
  if (canonicalMatch) {
    const [, prefix, round, heat] = canonicalMatch;
    return `${prefix}_r${Number(round)}_h${Number(heat)}`;
  }

  // Legacy/hybrid format often seen in old clients: *_division_X_Y
  // Example: championnats_du_senegal_2026_open_3_2 -> ..._open_r3_h2
  const legacyTrailingNumbers = normalized.match(/^(.*)_(\d+)_(\d+)$/);
  if (legacyTrailingNumbers) {
    const [, prefix, round, heat] = legacyTrailingNumbers;
    return `${prefix}_r${Number(round)}_h${Number(heat)}`;
  }

  return normalized;
};

export const buildLegacyHeatId = (
  competition: string,
  division: string,
  round: number,
  heatNumber: number
): string => `${competition}_${division}_R${round}_H${heatNumber}`;

export const buildHeatId = (
  competition: string,
  division: string,
  round: number,
  heatNumber: number
): string => normalizeHeatId(buildLegacyHeatId(competition, division, round, heatNumber));

export const ensureHeatId = (heatId: string | number): string => normalizeHeatId(String(heatId || ''));

export const ensurePersistedHeatId = (raw: unknown): string => {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
};

export interface IsFinalHeatContext {
  round: number;
  heatNumber?: number;
  totalRounds?: number;
  division?: string;
  heats?: ReadonlyArray<{ division?: string; round?: number; heat_number?: number }>;
  heatMetadata?: { round_name?: string; is_final?: boolean } | null;
  roundName?: string;
}

export const isFinalHeat = (context: IsFinalHeatContext): boolean => {
  const round = Number(context.round);
  if (!Number.isFinite(round) || round < 1) return false;

  // 1. Explicit metadata / names
  const explicitRoundName = context.roundName || context.heatMetadata?.round_name;
  if (explicitRoundName && /final|finale/i.test(explicitRoundName)) {
    return true;
  }
  if (context.heatMetadata?.is_final === true) {
    return true;
  }

  // 2. Planning heats structure. It is the authoritative fallback for
  // legacy events: their saved totalRounds can be stale (often 1) even when
  // the division contains later rounds.
  if (Array.isArray(context.heats) && context.heats.length > 0) {
    const divisionHeats = context.division
      ? context.heats.filter(
          (h) => (h.division || '').trim().toLowerCase() === context.division!.trim().toLowerCase()
        )
      : context.heats;

    if (divisionHeats.length > 0) {
      const maxRound = Math.max(...divisionHeats.map((h) => Number(h.round) || 1));
      return round >= maxRound;
    }
  }

  // 3. Total rounds from category policy / config when no planning is known.
  const totalRounds = Number(context.totalRounds);
  if (Number.isFinite(totalRounds) && totalRounds >= 1) {
    return round >= totalRounds;
  }

  return false;
};

export const getHeatRoundLabel = (round: number, finalRoundNumber?: number): string => {
  const parsedFinalRound = Number(finalRoundNumber);
  if (Number.isFinite(parsedFinalRound) && parsedFinalRound > 1 && round === parsedFinalRound) {
    return 'Finale';
  }

  return `R${round}`;
};

export const getHeatSeriesLabel = (
  round: number,
  heatNumber: number,
  finalRoundNumber?: number
): string => {
  const roundLabel = getHeatRoundLabel(round, finalRoundNumber);
  return roundLabel === 'Finale' ? roundLabel : `${roundLabel} H${heatNumber}`;
};

export const getHeatIdentifiers = (
  competition: string,
  division: string,
  round: number,
  heatNumber: number
) => {
  const legacy = buildLegacyHeatId(competition, division, round, heatNumber);
  const normalized = normalizeHeatId(legacy);
  return { legacy, normalized };
};

// Expose helper globally in the browser to avoid ReferenceError when bundled chunks
// reference it outside the module scope (defensive guard for legacy builds).
if (typeof window !== 'undefined') {
  (window as any).getHeatIdentifiers = getHeatIdentifiers;
}
