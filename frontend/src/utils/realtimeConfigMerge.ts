import type { AppConfig } from '../types';

const normalizeLineupToken = (value?: string) => String(value ?? '').trim().toUpperCase();

const isRealSurferName = (color: string, name?: string) => {
  const normalizedColor = normalizeLineupToken(color);
  const normalizedName = normalizeLineupToken(name);
  return Boolean(normalizedName) && normalizedName !== normalizedColor;
};

const lineupQuality = (config: Partial<AppConfig> | null | undefined) => {
  if (!config) return 0;
  const surfers = Array.isArray(config.surfers) ? config.surfers : [];
  const surferNames = config.surferNames || {};
  const surferCountries = config.surferCountries || {};

  return surfers.reduce((score, surfer) => {
    const normalizedSurfer = normalizeLineupToken(surfer);
    const hasRealName = isRealSurferName(normalizedSurfer, surferNames[normalizedSurfer] ?? surferNames[surfer]);
    const hasCountry = Boolean(String(surferCountries[normalizedSurfer] ?? surferCountries[surfer] ?? '').trim());
    return score + (hasRealName ? 10 : 0) + (hasCountry ? 1 : 0);
  }, 0);
};

const sameHeatScope = (prev: AppConfig, next: Partial<AppConfig>) =>
  normalizeLineupToken(next.division ?? prev.division) === normalizeLineupToken(prev.division) &&
  Number(next.round ?? prev.round) === Number(prev.round) &&
  Number(next.heatId ?? prev.heatId) === Number(prev.heatId);

export const mergeRealtimeConfigPreservingLineup = (
  prev: AppConfig,
  next: Partial<AppConfig>
): AppConfig => {
  const merged = {
    ...prev,
    ...next,
    surferNames: {
      ...(prev.surferNames || {}),
      ...(next.surferNames || {}),
    },
    surferCountries: {
      ...(prev.surferCountries || {}),
      ...(next.surferCountries || {}),
    },
  } as AppConfig;

  if (!sameHeatScope(prev, next)) {
    merged.surfersPerHeat = Array.isArray(merged.surfers) ? merged.surfers.length : merged.surfersPerHeat;
    // Clear stale priority when switching heat
    if (!next.priorityState) {
        merged.priorityState = { mode: 'equal', order: [], inFlight: [] };
    }
    return merged;
  }

  if (lineupQuality(next) < lineupQuality(prev)) {
    merged.surfers = prev.surfers;
    merged.surferNames = prev.surferNames || {};
    merged.surferCountries = prev.surferCountries || {};
    merged.surfersPerHeat = prev.surfersPerHeat;
    return merged;
  }

  merged.surfersPerHeat = Array.isArray(merged.surfers) ? merged.surfers.length : merged.surfersPerHeat;
  return merged;
};
