import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPodiumIdFromSearch } from '../utils/podium';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  resolvePriorityDisplaySignal,
  type ActivePrioritySnapshot,
} from '../domain/priorityDisplay';

const POLL_INTERVAL_MS = 1000;
const SIGNAL_STALE_MS = 3500;

const readEventId = (search: string): number | null => {
  const raw = new URLSearchParams(search).get('eventId');
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export default function PriorityDisplayPage() {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const podiumId = useMemo(() => getPodiumIdFromSearch(search), [search]);
  const eventId = useMemo(() => readEventId(search), [search]);
  const debug = useMemo(() => new URLSearchParams(search).get('debug') === '1', [search]);
  const [snapshot, setSnapshot] = useState<ActivePrioritySnapshot | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [lastError, setLastError] = useState('');
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured() || requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const result = eventId
        ? await supabase.rpc('get_active_priority', { p_event_id: eventId, p_podium_id: podiumId })
        : await supabase.rpc('get_active_priority', { p_podium_id: podiumId });
      if (result.error) throw result.error;
      setSnapshot((result.data?.[0] as ActivePrioritySnapshot | undefined) ?? null);
      setLastSuccessAt(Date.now());
      setLastError('');
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      requestInFlight.current = false;
    }
  }, [eventId, podiumId]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    const heartbeat = window.setInterval(() => setClock(Date.now()), 500);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(heartbeat);
    };
  }, [refresh]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const channel = supabase
      .channel(`priority-display-${podiumId}-${eventId ?? 'active'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'heat_realtime_config' }, () => { void refresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_heat_pointer' }, () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [eventId, podiumId, refresh]);

  useEffect(() => {
    document.title = `Priorité LED · Podium ${podiumId}`;
  }, [podiumId]);

  const fresh = lastSuccessAt !== null && clock - lastSuccessAt <= SIGNAL_STALE_MS;
  const signal = resolvePriorityDisplaySignal(snapshot, fresh);
  const requestFullscreen = () => {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
  };

  return (
    <main
      aria-label={`Sortie LED priorité podium ${podiumId}`}
      data-priority-color={signal.colors[0] ?? 'NOIR_SECURITE'}
      data-priority-order={signal.colors.join(',')}
      data-signal-reason={signal.reason}
      data-signal-fresh={fresh ? 'true' : 'false'}
      onDoubleClick={requestFullscreen}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        cursor: debug ? 'default' : 'none',
        display: 'flex',
        background: '#000000',
      }}
    >
      {signal.cssColors.map((cssColor, index) => (
        <div
          key={`${signal.colors[index]}-${index}`}
          aria-hidden="true"
          data-priority-rank={index + 1}
          data-priority-band-color={signal.colors[index]}
          style={{ flex: '1 1 0', height: '100%', background: cssColor }}
        />
      ))}
      {debug && (
        <aside style={{
          position: 'absolute',
          left: 16,
          bottom: 16,
          maxWidth: 'calc(100vw - 32px)',
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(0,0,0,.78)',
          color: '#fff',
          font: '600 14px system-ui, sans-serif',
        }}>
          Podium {podiumId} · {signal.colors.length > 0
            ? signal.colors.map((color, index) => `P${index + 1} ${color}`).join(' · ')
            : 'NOIR SÉCURITÉ'} · {signal.reason}
          {lastError ? ` · ${lastError}` : ''}
        </aside>
      )}
    </main>
  );
}
