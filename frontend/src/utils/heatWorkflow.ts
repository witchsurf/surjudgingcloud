import { getHeatIdentifiers } from './heat';
import type { AppConfig } from '../types';

export function getNextHeatSyncTarget(config: AppConfig, advanced: boolean): string | null {
    if (!advanced) return null;

    return getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
    ).normalized;
}
