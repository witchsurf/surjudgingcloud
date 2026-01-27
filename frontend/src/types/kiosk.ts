import type { AppConfig, HeatTimer } from './index';

/**
 * Judge information for kiosk display
 */
export interface Judge {
    id: string;
    name: string;
    email?: string;
}

/**
 * Surfer/Competitor information
 */
export interface Surfer {
    id: string;
    name: string;
    bibNumber?: number;
    color?: string;
}

/**
 * Complete kiosk configuration returned by kiosk-bootstrap workflow
 */
export interface KioskConfig {
    heat_id: string;
    event_id: number;
    judges: Judge[];
    surfers: Surfer[];
    timer: HeatTimer;
    config: AppConfig;
    status: 'waiting' | 'running' | 'paused' | 'finished';
}

/**
 * Request payload for kiosk initialization
 */
export interface KioskBootstrapRequest {
    eventId: number;
    heat_id: string;
}

/**
 * Request payload for heat synchronization
 */
export interface HeatSyncRequest {
    heat_id: string;
    status?: 'waiting' | 'running' | 'paused' | 'finished';
    timer_start_time?: string | null;
    timer_duration_minutes?: number;
    config_data?: AppConfig | null;
}
