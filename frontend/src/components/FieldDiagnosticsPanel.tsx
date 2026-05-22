import { Activity, AlertTriangle, CheckCircle2, Clock, Database, Radio, RotateCw, Server } from 'lucide-react';
import { replayOfflineQueues } from '../lib/offlineSyncCoordinator';
import { getSupabaseConfig } from '../lib/supabase';
import { useOfflineDiagnostics } from '../hooks/useOfflineDiagnostics';

const statusLabel = {
  queued: 'En file',
  replaying: 'Replay',
  synced: 'Synchronisé',
  failed: 'Échec',
  skipped: 'Ignoré',
} as const;

const statusClass = {
  queued: 'text-amber-700 bg-amber-50 border-amber-200',
  replaying: 'text-blue-700 bg-blue-50 border-blue-200',
  synced: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed: 'text-red-700 bg-red-50 border-red-200',
  skipped: 'text-slate-600 bg-slate-50 border-slate-200',
} as const;

const formatTime = (value: string | null) => {
  if (!value) return 'Jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Inconnu';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function FieldDiagnosticsPanel() {
  const diagnostics = useOfflineDiagnostics();
  const config = getSupabaseConfig();
  const recentOperations = diagnostics.operations.slice(0, 5);
  const recentRealtime = diagnostics.runtime.realtime.slice(0, 4);
  const hasError = diagnostics.lastReplayStatus === 'failed' || recentOperations.some((operation) => operation.status === 'failed');
  const realtimeFallback = diagnostics.runtime.realtime.some((entry) => entry.hasPolling || entry.status === 'fallback_polling');
  const schemaMismatch = diagnostics.runtime.schemaVersionMatches === false;

  return (
    <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {hasError || schemaMismatch ? (
              <AlertTriangle className="h-5 w-5 text-red-600" />
            ) : diagnostics.totalPending > 0 ? (
              <Clock className="h-5 w-5 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            )}
            <div>
              <div className="text-sm font-bold text-slate-900">Diagnostic terrain</div>
              <div className="text-xs text-slate-500">
                Mode {config.mode || 'auto'} · {diagnostics.isBrowserOnline ? 'navigateur en ligne' : 'navigateur hors ligne'}
                {realtimeFallback ? ' · fallback polling actif' : ' · realtime prioritaire'}
                {schemaMismatch ? ' · schéma à vérifier' : ''}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
              Legacy {diagnostics.legacyQueueCount}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
              Scores WAL {diagnostics.scoreWalCount}
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${diagnostics.totalPending > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
              Pending {diagnostics.totalPending}
            </span>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-100 px-4 pb-4 pt-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Database className="h-4 w-4" />
              Endpoint
            </div>
            <div className="truncate text-sm font-semibold text-slate-900">{config.supabaseUrl || 'Non configuré'}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Server className="h-4 w-4" />
              HP / API locale
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs font-bold">
              <span className={`rounded-full border px-2 py-0.5 ${diagnostics.runtime.hpReachable === false ? 'border-red-200 bg-red-50 text-red-700' : diagnostics.runtime.hpReachable ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                HP {diagnostics.runtime.hpReachable === null ? 'n/a' : diagnostics.runtime.hpReachable ? 'OK' : 'KO'}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${diagnostics.runtime.localSupabaseReachable === false ? 'border-red-200 bg-red-50 text-red-700' : diagnostics.runtime.localSupabaseReachable ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                Supabase {diagnostics.runtime.localSupabaseReachable === null ? 'n/a' : diagnostics.runtime.localSupabaseReachable ? 'OK' : 'KO'}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">Build {diagnostics.runtime.frontendBuild}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Activity className="h-4 w-4" />
              Dernier replay
            </div>
            <div className="text-sm font-semibold text-slate-900">{formatTime(diagnostics.lastReplayAt)}</div>
            {diagnostics.lastReplayStatus && (
              <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass[diagnostics.lastReplayStatus]}`}>
                {statusLabel[diagnostics.lastReplayStatus]}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void replayOfflineQueues('admin-diagnostics-manual')}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
          >
            <RotateCw className="h-4 w-4" />
            Rejouer les files
          </button>
        </div>

        <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${schemaMismatch ? 'border-red-200 bg-red-50 text-red-700' : diagnostics.runtime.schemaVersionMatches ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          <div className="font-bold">Version schéma HP</div>
          <div className="mt-1 grid gap-1 text-xs md:grid-cols-3">
            <span>Attendue: <strong>{diagnostics.runtime.expectedSchemaVersion}</strong></span>
            <span>Installée: <strong>{diagnostics.runtime.databaseSchemaVersion || 'inconnue'}</strong></span>
            <span>État: <strong>{diagnostics.runtime.schemaVersionMatches === null ? 'non vérifié' : diagnostics.runtime.schemaVersionMatches ? 'aligné' : 'mismatch'}</strong></span>
          </div>
        </div>

        {(diagnostics.lastReplayError || diagnostics.runtime.schemaVersionError || diagnostics.runtime.lastHpError) && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {diagnostics.lastReplayError || diagnostics.runtime.schemaVersionError || diagnostics.runtime.lastHpError}
          </div>
        )}

        <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Radio className="h-4 w-4" />
            Realtime local / fallback
          </div>
          {recentRealtime.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-500">Aucun canal realtime observé.</div>
          ) : (
            recentRealtime.map((entry) => (
              <div key={entry.key} className="grid gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[1fr_130px_120px_90px]">
                <span className="min-w-0 truncate font-semibold text-slate-800">{entry.label}</span>
                <span className={`w-fit rounded-full border px-2 py-0.5 font-bold ${entry.status === 'subscribed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : entry.status === 'fallback_polling' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  {entry.status === 'subscribed' ? 'Realtime OK' : entry.status === 'fallback_polling' ? 'Fallback polling' : entry.status}
                </span>
                <span className="font-mono text-slate-500">{entry.hasPolling ? 'poll actif' : 'poll off'}</span>
                <span className="text-right font-mono text-slate-500">{formatTime(entry.lastActionAt || entry.updatedAt)}</span>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
          {recentOperations.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-500">Aucune opération offline enregistrée.</div>
          ) : (
            recentOperations.map((operation) => (
              <div key={operation.id} className="grid gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[110px_1fr_90px_90px]">
                <span className={`w-fit rounded-full border px-2 py-0.5 font-bold ${statusClass[operation.status]}`}>
                  {statusLabel[operation.status]}
                </span>
                <span className="min-w-0 truncate font-semibold text-slate-800">
                  {operation.kind}{operation.target ? ` · ${operation.target}` : ''}
                </span>
                <span className="font-mono text-slate-500">{operation.queue}</span>
                <span className="text-right font-mono text-slate-500">{formatTime(operation.updatedAt)}</span>
                {operation.error && (
                  <span className="min-w-0 truncate text-red-600 md:col-span-4">{operation.error}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
