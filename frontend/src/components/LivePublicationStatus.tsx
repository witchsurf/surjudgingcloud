import { Activity, AlertTriangle, CheckCircle2, Clock, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isLocalSupabaseMode, supabase } from '../lib/supabase';
import {
  deriveLivePublicationState,
  livePublicationLabel,
  type LivePublicationSnapshot,
  type LivePublicationState,
} from '../lib/livePublicationStatus';

const formatTime = (value?: string | null) => {
  if (!value) return 'jamais';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'inconnu';
};

const style: Record<LivePublicationState, string> = {
  NOT_CONFIGURED: 'border-slate-200 bg-slate-50 text-slate-700',
  LIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DEGRADED: 'border-amber-200 bg-amber-50 text-amber-800',
  BACKLOG: 'border-amber-200 bg-amber-50 text-amber-800',
  OFFLINE: 'border-red-200 bg-red-50 text-red-700',
};

export default function LivePublicationStatus() {
  const [snapshot, setSnapshot] = useState<LivePublicationSnapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLocalSupabaseMode()) return;
    let active = true;
    const refresh = async () => {
      const { data, error } = await supabase.rpc('get_live_publication_status');
      if (!active) return;
      if (error) {
        setReadError('Diagnostic live indisponible');
        return;
      }
      setReadError(null);
      setSnapshot(data as LivePublicationSnapshot);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  if (!isLocalSupabaseMode()) return null;
  const state = readError ? 'OFFLINE' : deriveLivePublicationState(snapshot);
  const backlog = (snapshot?.pending_count || 0) + (snapshot?.sending_count || 0) + (snapshot?.quarantined_count || 0);
  const Icon = state === 'LIVE' ? CheckCircle2 : state === 'BACKLOG' ? Clock : state === 'NOT_CONFIGURED' ? Radio : AlertTriangle;

  return (
    <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${style[state]}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <div>
          <div className="text-sm font-bold">Internet Live : {livePublicationLabel[state]}</div>
          <div className="text-xs opacity-80">
            {readError || (snapshot?.configured
              ? `Field ${snapshot.field_instance_id} · heartbeat ${formatTime(snapshot.worker_heartbeat_at)} · dernier ACK ${formatTime(snapshot.last_success_at)}`
              : 'Le jugement local reste autonome ; aucune publication externe ne part.')}
          </div>
        </div>
      </div>
      {snapshot?.configured && (
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="rounded-full border border-current/20 bg-white/40 px-2 py-1">File {backlog}</span>
          {snapshot.last_acked_sequence !== null && snapshot.last_acked_sequence !== undefined && (
            <span className="rounded-full border border-current/20 bg-white/40 px-2 py-1">ACK #{snapshot.last_acked_sequence}</span>
          )}
          {snapshot.last_error && <span className="max-w-56 truncate" title={snapshot.last_error}>Erreur : {snapshot.last_error}</span>}
        </div>
      )}
    </div>
  );
}
