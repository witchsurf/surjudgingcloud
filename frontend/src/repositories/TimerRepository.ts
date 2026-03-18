import { BaseRepository } from './BaseRepository';
import { ensureHeatId } from '../utils/heat';
import { logger } from '../lib/logger';
import type { HeatTimer } from '../types';
import { saveOffline } from '../lib/supabase';

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
            timer_start_time: timer.startTime,
            timer_duration_minutes: timer.duration,
            updated_at: new Date().toISOString(),
        };

        return this.execute(
            // Online Operation
            async () => {
                this.ensureSupabase();

                const { error } = await this.supabase!
                    .from(this.tableName)
                    .upsert(payload, { onConflict: 'heat_id' });

                if (error) throw error;
                logger.info('TimerRepository', 'Timer state saved online', { heatId: normalizedHeatId });
            },
            // Offline Fallback
            () => {
                logger.info('TimerRepository', 'Timer state queued offline', { heatId: normalizedHeatId });
                saveOffline({
                    table: this.tableName,
                    action: 'insert', // upsert equivalent for remote sync
                    payload: payload,
                    timestamp: Date.now()
                });
            },
            'saveTimerState'
        );
    }
}

export const timerRepository = new TimerRepository();
