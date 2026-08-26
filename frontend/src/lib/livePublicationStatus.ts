export type LivePublicationSnapshot = {
  configured: boolean;
  local_field: boolean;
  field_instance_id?: string;
  worker_id?: string | null;
  worker_heartbeat_at?: string | null;
  last_acked_sequence?: number | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error?: string | null;
  pending_count?: number;
  sending_count?: number;
  quarantined_count?: number;
  oldest_pending_at?: string | null;
};

export type LivePublicationState = 'NOT_CONFIGURED' | 'LIVE' | 'DEGRADED' | 'BACKLOG' | 'OFFLINE';

const HEARTBEAT_MAX_AGE_MS = 45_000;
const RECENT_ERROR_MAX_AGE_MS = 5 * 60_000;

const isRecent = (value: string | null | undefined, maxAgeMs: number, now: number) => {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
};

export function deriveLivePublicationState(snapshot: LivePublicationSnapshot | null, now = Date.now()): LivePublicationState {
  if (!snapshot?.local_field || !snapshot.configured) return 'NOT_CONFIGURED';
  const backlog = (snapshot.pending_count || 0) + (snapshot.sending_count || 0) + (snapshot.quarantined_count || 0);
  if (!isRecent(snapshot.worker_heartbeat_at, HEARTBEAT_MAX_AGE_MS, now)) return 'OFFLINE';
  if (backlog > 0) return 'BACKLOG';
  if (isRecent(snapshot.last_error_at, RECENT_ERROR_MAX_AGE_MS, now)) return 'DEGRADED';
  return 'LIVE';
}

export const livePublicationLabel: Record<LivePublicationState, string> = {
  NOT_CONFIGURED: 'Publication Internet non configurée',
  LIVE: 'LIVE · publication active',
  DEGRADED: 'DEGRADED · dernière publication en erreur',
  BACKLOG: 'BACKLOG · publications en attente',
  OFFLINE: 'OFFLINE · worker non détecté',
};
