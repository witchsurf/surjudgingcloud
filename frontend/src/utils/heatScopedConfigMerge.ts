/**
 * heatScopedConfigMerge
 *
 * Applies an incoming config update (from realtime or active_heat_pointer)
 * to the current config. When the heat identity (division/round/heatId)
 * changes, priority state and surfer names are reset so no stale data
 * bleeds into the new heat.
 *
 * Previously duplicated between JudgePage.tsx and PriorityJudgePage.tsx.
 */

import type { AppConfig } from '../types';
import { buildEqualPriorityState } from './priority';
import { mergeRealtimeConfigPreservingLineup } from './realtimeConfigMerge';

/**
 * Returns true when division/round/heatId all differ between prev and next.
 * Normalises casing and numeric comparison.
 */
export function isHeatScopeChanged(prev: AppConfig, updates: Partial<AppConfig>): boolean {
  const prevDivision = (prev.division || '').trim().toUpperCase();
  const nextDivision = (updates.division ?? prev.division ?? '').trim().toUpperCase();
  return (
    prevDivision !== nextDivision ||
    prev.round !== (updates.round ?? prev.round) ||
    prev.heatId !== (updates.heatId ?? prev.heatId)
  );
}

/**
 * Merges `updates` into `prev`, preserving lineup quality and priority state
 * when the heat scope is unchanged. Resets both when the heat changes.
 */
export function applyHeatScopedConfig(
  prev: AppConfig,
  updates: Partial<AppConfig>
): AppConfig {
  const heatChanged = isHeatScopeChanged(prev, updates);
  const merged = mergeRealtimeConfigPreservingLineup(prev, updates);

  if (!heatChanged) {
    return merged;
  }

  return {
    ...merged,
    priorityState: buildEqualPriorityState(),
    surferNames: {},
    surferCountries: {},
  };
}
