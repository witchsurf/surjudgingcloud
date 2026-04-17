import { BaseRepository } from './BaseRepository';
import { ensureHeatId } from '../utils/heat';
import { logger } from '../lib/logger';
import type { HeatTimer } from '../types';
import { saveOffline } from '../lib/supabase';

const isHeatRealtimeRpcUnavailable = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
        status?: number;
        statusCode?: number;
    };
    const text = [
        candidate.code,
        candidate.message,
        candidate.details,
        candidate.hint,
        String(candidate.status ?? ''),
        String(candidate.statusCode ?? ''),
        JSON.stringify(candidate),
    ].join(' ').toLowerCase();

    return (
        text.includes('upsert_heat_realtime_config')
        && (
            text.includes('pgrst202')
            || text.includes('schema cache')
            || text.includes('could not find the function')
            || text.includes('42883')
        )
    );
};

export class TimerRepository extends BaseRepository {
    constructor() {
        super('heat_realtime_config');
    }

    /**
     * Save the timer state (isRunning, startTime, duration) for a heat.
     * Uses the offline queue if the network is unavailable.
     */
    async saveTimerState(heatId: string, timer: HeatTimer): Promise<void> {
        const normalizedHeatId = ensureHeatId(heatId);
        
        const payload = {
            heat_id: normalizedHeatId,
            status: timer.isRunning ? 'running' : 'paused',
            timer_start_time: timer.startTime ? timer.startTime.toISOString() : null,
            timer_duration_minutes: timer.duration,
            updated_at: new Date().toISOString(),
        };

        return this.execute(
            // Online Operation
            async () => {
                this.ensureSupabase();

                const { error } = await this.supabase!.rpc('upsert_heat_realtime_config', {
                    p_heat_id: normalizedHeatId,
                    p_status: payload.status,
                    p_set_timer_start_time: true,
                    p_timer_start_time: payload.timer_start_time,
                    p_set_timer_duration: true,
                    p_timer_duration_minutes: payload.timer_duration_minutes,
                    p_set_config_data: false,
                    p_config_data: null,
                    p_updated_by: 'timer_repository',
                });

                if (error && !isHeatRealtimeRpcUnavailable(error)) {
                    throw error;
                }

                if (error) {
                    const { error: fallbackError } = await this.supabase!
                        .from(this.tableName)
                        .upsert(payload, { onConflict: 'heat_id' });

                    if (fallbackError) throw fallbackError;
                }

                logger.info('TimerRepository', 'Timer state saved online', { heatId: normalizedHeatId });
            },
            // Offline Fallback
            () => {
                logger.info('TimerRepository', 'Timer state queued offline', { heatId: normalizedHeatId });
                saveOffline({
                    table: this.tableName,
                    action: 'upsert',
                    payload: {
                        rows: payload,
                        options: { onConflict: 'heat_id' }
                    },
                    timestamp: Date.now()
                });
            },
            'saveTimerState'
        );
    }
}

export const timerRepository = new TimerRepository();
