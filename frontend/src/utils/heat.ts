export const normalizeHeatId = (raw: string | null | undefined): string => {
  if (!raw) return '';
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
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

export const ensureHeatId = (heatId: string): string => normalizeHeatId(heatId);

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
