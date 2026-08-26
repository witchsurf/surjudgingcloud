import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ObsOverlay from '../components/ObsOverlay';
import { getSupabaseConfig } from '../lib/supabase';
import { resolvePanelContext } from '../domain/scoring/panelContext';
import { resolveOverlaySnapshot } from '../domain/scoring/overlaySnapshot';
import { computeEffectiveInterferences } from '../utils/interference';
import type { AppConfig, HeatTimer, Score } from '../types';

const emptyConfig: AppConfig = { competition:'', division:'OPEN', round:1, heatId:1, judges:[], surfers:[], waves:15, judgeNames:{}, surferNames:{}, surferCountries:{}, tournamentType:'elimination', totalSurfers:0, surfersPerHeat:0, totalHeats:0, totalRounds:1 };
const emptyTimer: HeatTimer = { isRunning:false, startTime:null, duration:20 };

export default function LiveOverlayPage() {
  const [params] = useSearchParams();
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fieldId = params.get('field_id') || '';
  const token = params.get('token') || '';
  const podium = params.get('podium') || 'A';

  useEffect(() => {
    if (!fieldId || !token) { setError('URL OBS incomplète'); return; }
    let active = true;
    const refresh = async () => {
      try {
        const base = getSupabaseConfig().supabaseUrl.replace(/\/$/, '');
        const response = await fetch(`${base}/functions/v1/live-overlay?field_id=${encodeURIComponent(fieldId)}&podium=${encodeURIComponent(podium)}&token=${encodeURIComponent(token)}`, { cache:'no-store' });
        if (!response.ok) throw new Error(`Live overlay HTTP ${response.status}`);
        const snapshot = await response.json();
        if (active) { setData(snapshot); setError(null); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { active=false; window.clearInterval(timer); };
  }, [fieldId, podium, token]);

  const view = useMemo(() => {
    const heat = data?.heat || {}; const realtime = data?.heat_realtime_config || {}; const heatConfig = data?.heat_config || {};
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const surfers = entries.map((entry: any) => String(entry.color || '').toUpperCase()).filter(Boolean);
    const surferNames = Object.fromEntries(entries.filter((entry: any) => entry.color && entry.name).map((entry: any) => [String(entry.color).toUpperCase(), entry.name]));
    const surferCountries = Object.fromEntries(entries.filter((entry: any) => entry.color && entry.country).map((entry: any) => [String(entry.color).toUpperCase(), entry.country]));
    const config: AppConfig = { ...emptyConfig, competition:heat.competition || '', division:heat.division || 'OPEN', round:Number(heat.round || 1), heatId:Number(heat.heat_number || 1), judges:Array.isArray(heatConfig.judges) ? heatConfig.judges : [], surfers, surferNames, surferCountries, waves:Number(heatConfig.waves || 15), event_id:heat.event_id };
    const timer: HeatTimer = { isRunning: realtime.status === 'running', startTime: realtime.timer_start_time ? new Date(realtime.timer_start_time) : null, duration:Number(realtime.timer_duration_minutes || 20) };
    const panel = resolvePanelContext({ heatConfigJudges: heatConfig.judges });
    const scores = (Array.isArray(data?.scores) ? data.scores : []) as Score[];
    const calls = Array.isArray(data?.interference_calls) ? data.interference_calls : [];
    const effectiveInterferences = panel.judgeCount ? computeEffectiveInterferences(calls, panel.judgeCount) : [];
    const scoring = resolveOverlaySnapshot({ heatId:data?.active_heat_id || '', config, scores, panelContext:panel, effectiveInterferences });
    return { config, timer, status:realtime.status || heat.status || 'waiting', scoring };
  }, [data]);

  if (error || !data?.active_heat_id) return <main className="min-h-screen bg-transparent p-8 text-white"><div className="inline-flex rounded-xl bg-slate-950/95 px-5 py-3 text-sm font-bold shadow-2xl ring-1 ring-white/20">OBS Live · {error || 'En attente du heat actif'}</div></main>;
  return <ObsOverlay config={view.config} timer={view.timer} heatStatus={view.status} snapshot={view.scoring.snapshot} scoringIssue={view.scoring.issue} scoringMessage={view.scoring.message} />;
}
