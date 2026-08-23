import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parsePlanningCsv } from '../adapters/planningImport/csvParser';
import type {
  PlanningImportDiagnostic,
  PlanningImportParseResult,
  PlanningImportParticipant,
} from '../domain/planningImport/contracts';
import { computeHeats, type ComputeResult, type FormatType } from '../utils/bracket';
import { planningSafetyRepository } from '../repositories/PlanningSafetyRepository';
import type { PlanningSafetyPreflightResult } from '../repositories/contracts';
import BracketPreview from './BracketPreview';
import { persistPlanningImportSafely } from '../services/persistPlanningImportSafely';
import { categoryPlanningPolicyRepository, type CategoryPlanningFormat, type CategoryPlanningPolicy } from '../repositories/CategoryPlanningPolicyRepository';
import { competitionAdminRoute } from '../domain/eventWorkflow';
import { planningStatusRepository, type ServerPlanningSummary } from '../repositories/PlanningStatusRepository';

type ImportUiState = 'IDLE' | 'PARSING' | 'VALID' | 'INVALID' | 'PREVIEW_READY' | 'ERROR';
type LocalFileType = 'CSV' | 'XLSX';

interface XlsxMetadata {
  workbookName: string;
  worksheetName: string | null;
  availableWorksheets: readonly string[];
}

interface PlanningImportPanelProps {
  eventId?: number | null;
  eventName?: string;
  onPersisted?: (result: {
    category: string;
    participantCount: number;
    heatCount: number;
    participants: readonly PlanningImportParticipant[];
  }) => void;
}

type PersistenceState = 'IDLE' | 'CONFIRMING' | 'PERSISTING' | 'SUCCESS' | 'BLOCKED' | 'ERROR';

const formatLabel = (fmt: string | null | undefined): string => {
  switch (fmt) {
    case 'man_on_man': return 'Man-on-Man';
    case 'repechage': return 'Repêchage';
    case 'elimination':
    case 'single-elim': return 'Élimination directe';
    default: return fmt || 'Élimination directe';
  }
};

const readText = async (file: File): Promise<string> => {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture CSV impossible'));
    reader.readAsText(file);
  });
};

const readArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Lecture XLSX impossible'));
    reader.readAsArrayBuffer(file);
  });
};

const diagnosticLabel = (diagnostic: PlanningImportDiagnostic) => {
  if (diagnostic.sourceRow == null) return diagnostic.message;
  const duplicatePrefix = new RegExp(`^Ligne ${diagnostic.sourceRow}:?\\s*`, 'i');
  return `Ligne ${diagnostic.sourceRow} — ${diagnostic.message.replace(duplicatePrefix, '')}`;
};

const groupParticipants = (participants: readonly PlanningImportParticipant[]) => {
  const groups = new Map<string, PlanningImportParticipant[]>();
  participants.forEach((participant) => {
    const group = groups.get(participant.category) ?? [];
    group.push(participant);
    groups.set(participant.category, group);
  });
  return groups;
};

export default function PlanningImportPanel({ eventId = null, eventName, onPersisted }: PlanningImportPanelProps) {
  let navigate: ReturnType<typeof useNavigate> | null = null;
  try {
    navigate = useNavigate();
  } catch {
    navigate = null;
  }

  const [serverState, setServerState] = useState<ServerPlanningSummary>({
    loading: false, exists: false, heatCount: 0, participantCount: 0, categories: [], policies: {},
  });
  const [isRegenerating, setIsRegenerating] = useState(false);

  const [uiState, setUiState] = useState<ImportUiState>('IDLE');
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<LocalFileType | null>(null);
  const [result, setResult] = useState<PlanningImportParseResult | null>(null);
  const [xlsxMetadata, setXlsxMetadata] = useState<XlsxMetadata | null>(null);
  const [selectedWorksheet, setSelectedWorksheet] = useState('');
  
  const [format, setFormat] = useState<FormatType>('single-elim');
  const [categoryPolicies, setCategoryPolicies] = useState<Record<string, CategoryPlanningPolicy>>({});
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, ComputeResult>>({});
  const [fatalError, setFatalError] = useState<string | null>(null);
  
  const [preflightState, setPreflightState] = useState<'IDLE' | 'CHECKING' | 'SAFE' | 'BLOCKED' | 'UNKNOWN'>('IDLE');
  const [preflightResults, setPreflightResults] = useState<Record<string, PlanningSafetyPreflightResult>>({});
  const [preflightError, setPreflightError] = useState<string | null>(null);
  
  const [overwrite, setOverwrite] = useState(true);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>('IDLE');
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const persistingRef = useRef(false);

  const validEventId = Number.isSafeInteger(eventId) && Number(eventId) > 0;

  const checkServerPlanning = async () => {
    if (!validEventId || !eventId) return;
    setServerState((prev) => ({ ...prev, loading: true }));
    try {
      const summary = await planningStatusRepository.fetchServerPlanningSummary(Number(eventId));
      setCategoryPolicies((curr) => ({ ...summary.policies, ...curr }));
      setServerState(summary);
    } catch {
      setServerState({ loading: false, exists: false, heatCount: 0, participantCount: 0, categories: [], policies: {} });
    }
  };

  useEffect(() => {
    void checkServerPlanning();
  }, [eventId]);

  const participantGroups = useMemo(
    () => groupParticipants(result?.validRows ?? []),
    [result],
  );
  const categories = useMemo(() => [...participantGroups.keys()], [participantGroups]);

  const policyFor = (category: string): CategoryPlanningPolicy => categoryPolicies[category] ?? {
    event_id: Number(eventId ?? 0), category, base_format: 'elimination', transition_round: null, transition_format: null, version: 1,
  };

  const updatePolicy = (category: string, patch: Partial<CategoryPlanningPolicy>) => {
    setCategoryPolicies((current) => ({ ...current, [category]: { ...policyFor(category), ...patch } }));
    setPolicyMessage(null);
    setPreviews({});
    setPreflightState('IDLE');
  };

  const savePolicies = async () => {
    if (!validEventId) return;
    try {
      for (const category of categories) await categoryPlanningPolicyRepository.upsert(policyFor(category));
      setPolicyMessage('Politiques par catégorie enregistrées sur le serveur.');
    } catch (error) {
      setPolicyMessage(`Politique refusée : ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const applyResult = (
    nextResult: PlanningImportParseResult,
    metadata: XlsxMetadata | null,
  ) => {
    setResult(nextResult);
    setXlsxMetadata(metadata);
    setPreviews({});
    setPreflightState('IDLE');
    setPreflightResults({});
    setPreflightError(null);
    setPersistenceState('IDLE');
    setPersistenceMessage(null);
    setUiState(nextResult.input !== null ? 'VALID' : 'INVALID');
  };

  const parseLocalFile = async (nextFile: File, worksheetName?: string) => {
    const extension = nextFile.name.split('.').pop()?.toLowerCase();
    if (extension !== 'csv' && extension !== 'xlsx') {
      setFatalError('Format non supporté. Choisissez un fichier .csv ou .xlsx.');
      setUiState('ERROR');
      return;
    }

    setUiState('PARSING');
    setFatalError(null);
    setPreviews({});
    try {
      if (extension === 'csv') {
        setFileType('CSV');
        setXlsxMetadata(null);
        applyResult(parsePlanningCsv(await readText(nextFile), {
          source: 'csv', sourceName: nextFile.name,
        }), null);
        return;
      }

      setFileType('XLSX');
      const { parsePlanningXlsx } = await import('../adapters/planningImport/xlsxParser');
      const parsed = await parsePlanningXlsx(await readArrayBuffer(nextFile), {
        workbookName: nextFile.name,
        worksheetName,
      });
      setSelectedWorksheet(parsed.metadata.worksheetName ?? worksheetName ?? '');
      applyResult(parsed, parsed.metadata);
    } catch (cause) {
      setFatalError(cause instanceof Error ? cause.message : String(cause));
      setUiState('ERROR');
    }
  };

  const handleFile = async (nextFile: File | null) => {
    setFile(nextFile);
    setResult(null);
    setXlsxMetadata(null);
    setSelectedWorksheet('');
    setPreviews({});
    if (!nextFile) {
      setFileType(null);
      setUiState('IDLE');
      return;
    }
    await parseLocalFile(nextFile);
  };

  const runPreflight = async (cats: string[], overwriteValue = overwrite) => {
    if (!eventId || !Number.isSafeInteger(eventId) || eventId <= 0) {
      setPreflightState('UNKNOWN');
      setPreflightError('Événement absent ou invalide : la sécurité planning ne peut pas être déclarée SAFE.');
      return;
    }
    setPreflightState('CHECKING');
    setPreflightResults({});
    setPreflightError(null);
    try {
      const results: Record<string, PlanningSafetyPreflightResult> = {};
      let globalState: typeof preflightState = 'SAFE';

      for (const category of cats) {
        const safety = await planningSafetyRepository.preflight({
          eventId, category, proposedHeatIds: [], overwrite: overwriteValue,
        });
        results[category] = safety;
        if (safety.state === 'BLOCKED') globalState = 'BLOCKED';
        else if (safety.state !== 'SAFE' && globalState === 'SAFE') globalState = safety.state;
      }
      
      setPreflightResults(results);
      setPreflightState(globalState);
    } catch (cause) {
      setPreflightState('UNKNOWN');
      setPreflightError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const generatePreview = () => {
    if (!result?.input || categories.length === 0) return;
    try {
      setPersistenceState('IDLE');
      setPersistenceMessage(null);
      
      const newPreviews: Record<string, ComputeResult> = {};
      categories.forEach(category => {
        const participants = participantGroups.get(category) ?? [];
        const safeParticipants = participants.map(p => ({ ...p, country: p.country ?? undefined }));
        newPreviews[category] = computeHeats(safeParticipants, { format, preferredHeatSize: 'auto', variant: 'V1' });
      });
      
      setPreviews(newPreviews);
      setFatalError(null);
      setUiState('PREVIEW_READY');
      void runPreflight(categories);
    } catch (cause) {
      setFatalError(cause instanceof Error ? cause.message : String(cause));
      setUiState('ERROR');
    }
  };

  const totalParticipantCount = categories.reduce((sum, cat) => sum + (participantGroups.get(cat)?.length ?? 0), 0);
  const totalHeatCount = Object.values(previews).reduce((total, preview) => 
    total + (preview.rounds.reduce((sum, round) => sum + round.heats.length, 0) ?? 0), 0
  );
  
  const totalReplacedHeatCount = Object.values(preflightResults).reduce((sum, res) => sum + res.targetedHeats.length, 0);

  const hasPreviews = Object.keys(previews).length > 0;
  const canPersist = Boolean(
    result?.input
    && hasPreviews
    && validEventId
    && categories.length > 0
    && format
    && preflightState === 'SAFE'
    && persistenceState !== 'PERSISTING'
    && persistenceState !== 'SUCCESS',
  );

  const requestConfirmation = () => {
    if (!canPersist) return;
    setPersistenceState('CONFIRMING');
    setPersistenceMessage(null);
  };

  const persistPlanning = async () => {
    if (!canPersist || !result?.input || Object.keys(previews).length === 0 || !eventId || persistingRef.current) return;
    persistingRef.current = true;
    setPersistenceState('PERSISTING');
    setPersistenceMessage(null);
    try {
      for (const category of categories) {
        const preview = previews[category];
        if (!preview) continue;
        
        await persistPlanningImportSafely({
          input: result.input,
          preview,
          eventId,
          eventName,
          category,
          format,
          overwrite,
        });
      }
      
      setPersistenceState('SUCCESS');
      setPersistenceMessage(`Planning créé avec succès — ${categories.length} catégories, ${totalHeatCount} heats, ${totalParticipantCount} participants — ${new Date().toLocaleString('fr-FR')}`);
      
      onPersisted?.({
        category: categories.join(', '),
        participantCount: totalParticipantCount,
        heatCount: totalHeatCount,
        participants: result.validRows,
      });

      // Refresh server state and exit regeneration mode
      void checkServerPlanning();
      setIsRegenerating(false);
    } catch (cause) {
      const error = cause as { code?: string; message?: string; details?: string };
      if (error?.code === 'PGRST202') {
        setPersistenceState('ERROR');
        setPersistenceMessage('Le serveur local doit être mis à jour avant de créer les heats. Aucun fallback legacy n’a été tenté.');
      } else if (`${error?.message ?? ''} ${error?.details ?? ''}`.includes('HEAT_PLANNING_BLOCKED')) {
        setPersistenceState('BLOCKED');
        setPreflightState('BLOCKED');
        setPreflightResults({});
        setPreflightError('Les données ont changé depuis le preflight. Relancez le contrôle de sécurité planning.');
        setPersistenceMessage('Création bloquée par le serveur : des données sportives protègent désormais ces heats. La preview est conservée.');
      } else {
        setPersistenceState('ERROR');
        setPersistenceMessage(`Création impossible : ${error?.message ?? String(cause)}. Des participants peuvent avoir été enregistrés avant le refus du planning.`);
      }
    } finally {
      persistingRef.current = false;
    }
  };

  const handleContinueCompetition = () => {
    if (!eventId) return;
    const targetRoute = competitionAdminRoute(eventId);
    if (navigate) {
      navigate(targetRoute);
    } else {
      window.location.href = targetRoute;
    }
  };

  // If planning already exists on the server and user is not explicitly regenerating
  if (serverState.exists && !isRegenerating) {
    return (
      <section data-testid="planning-import-panel" className="space-y-5 rounded-3xl border border-emerald-600/70 bg-slate-900/90 p-6 shadow-xl shadow-emerald-500/10">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-800/60 pb-4">
          <div className="flex items-center gap-3">
            <span className="h-3.5 w-3.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-xl font-bold text-emerald-200">PLANNING EXISTANT</h2>
          </div>
          <span className="rounded-full border border-emerald-500/50 bg-emerald-900/40 px-3 py-1 text-xs font-semibold text-emerald-300">
            Serveur synchronisé ({serverState.heatCount} heats)
          </span>
        </header>

        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3.5">
            <dt className="text-xs text-slate-400">Événement</dt>
            <dd className="mt-1 font-semibold text-white">{eventName ?? `#${eventId}`}</dd>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3.5">
            <dt className="text-xs text-slate-400">Participants enregistrés</dt>
            <dd className="mt-1 font-semibold text-white">{serverState.participantCount}</dd>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3.5">
            <dt className="text-xs text-slate-400">Heats au total</dt>
            <dd className="mt-1 font-semibold text-white">{serverState.heatCount}</dd>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-3.5">
            <dt className="text-xs text-slate-400">Catégories actives</dt>
            <dd className="mt-1 font-semibold text-white">{serverState.categories.length}</dd>
          </div>
        </dl>

        <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Formats & Politiques par catégorie</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {serverState.categories.map((cat) => {
              const pol = serverState.policies[cat];
              return (
                <div key={cat} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-200">
                  <strong className="block font-semibold text-cyan-200">{cat}</strong>
                  <p className="mt-1 text-slate-300">Base : {formatLabel(pol?.base_format ?? 'elimination')}</p>
                  {pol?.transition_round ? (
                    <p className="text-amber-300 font-medium">
                      Transition R{pol.transition_round} → {formatLabel(pol.transition_format ?? 'man_on_man')}
                    </p>
                  ) : (
                    <p className="text-slate-500">Sans transition</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row pt-2">
          <button
            type="button"
            data-testid="continue-competition-button"
            onClick={handleContinueCompetition}
            className="flex-1 rounded-xl bg-emerald-600 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500 transition active:scale-[0.99] text-center"
          >
            CONTINUER LA COMPÉTITION
          </button>
          <button
            type="button"
            data-testid="regenerate-planning-button"
            onClick={() => setIsRegenerating(true)}
            className="rounded-xl border border-slate-600 bg-slate-800/80 px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
          >
            Modifier / Régénérer le planning
          </button>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="planning-import-panel" className="space-y-5 rounded-3xl border border-cyan-700/60 bg-slate-900/80 p-6 shadow-xl shadow-cyan-500/10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold text-white">
              {serverState.exists ? 'Modifier / Régénérer le planning' : 'Nouvel import hors ligne'}
            </h2>
            <span className="rounded-full border border-emerald-500/70 px-3 py-1 text-xs font-semibold text-emerald-200">
              {serverState.exists ? 'Régénération explicite' : 'Workflow recommandé'}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-400">CSV ou XLSX local → diagnostics → preview → contrôle serveur SAFE → création atomique sur le HP.</p>
        </div>

        {serverState.exists && (
          <button
            type="button"
            onClick={() => setIsRegenerating(false)}
            className="rounded-xl border border-slate-600 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Annuler et revenir à la compétition
          </button>
        )}
      </header>

      {serverState.exists && (
        <div role="alert" className="rounded-2xl border border-amber-500/60 bg-amber-500/10 p-3.5 text-sm text-amber-200">
          <strong>Attention :</strong> Un planning existe déjà ({serverState.heatCount} heats, {serverState.participantCount} participants). Toute régénération sera soumise au contrôle de sécurité serveur. Les heats contenant des scores ou verrouillés seront strictement protégés contre tout écrasement.
        </div>
      )}

      <label className="block rounded-2xl border border-dashed border-slate-600 p-4 text-sm text-slate-200">
        <span className="mb-2 block font-medium">Fichier local CSV/XLSX</span>
        <input
          aria-label="Fichier local CSV/XLSX"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </label>

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
        <div><span className="text-slate-500">État</span><strong className="block text-slate-100">{uiState}</strong></div>
        <div><span className="text-slate-500">Fichier</span><strong className="block break-all text-slate-100">{file?.name ?? '—'}</strong></div>
        <div><span className="text-slate-500">Type</span><strong className="block text-slate-100">{fileType ?? '—'}</strong></div>
        <div><span className="text-slate-500">Onglet</span><strong className="block text-slate-100">{xlsxMetadata?.worksheetName ?? '—'}</strong></div>
        <div><span className="text-slate-500">Lignes valides</span><strong className="block text-slate-100">{result?.validRows.length ?? 0}</strong></div>
        <div><span className="text-slate-500">Erreurs</span><strong className="block text-slate-100">{result?.errors.length ?? 0}</strong></div>
        <div><span className="text-slate-500">Warnings</span><strong className="block text-slate-100">{result?.warnings.length ?? 0}</strong></div>
        <div><span className="text-slate-500">Catégories</span><strong className="block text-slate-100">{categories.length}</strong></div>
      </div>

      {xlsxMetadata && xlsxMetadata.availableWorksheets.length > 1 && !xlsxMetadata.worksheetName && file && (
        <div className="rounded-2xl border border-amber-600/70 bg-amber-500/10 p-4">
          <label className="text-sm text-amber-100">
            Sélectionnez un onglet
            <select
              aria-label="Sélectionnez un onglet"
              value={selectedWorksheet}
              onChange={(event) => {
                const worksheet = event.target.value;
                setSelectedWorksheet(worksheet);
                if (worksheet) void parseLocalFile(file, worksheet);
              }}
              className="mt-2 block w-full rounded-xl border border-amber-600 bg-slate-950 px-3 py-2"
            >
              <option value="">Choisir…</option>
              {xlsxMetadata.availableWorksheets.map((worksheet) => <option key={worksheet}>{worksheet}</option>)}
            </select>
          </label>
        </div>
      )}

      {fatalError && <div role="alert" className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-200">{fatalError}</div>}

      {(result?.errors.length || result?.warnings.length) ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-red-200">Erreurs</h3>
            <ul className="mt-2 space-y-1 text-sm text-red-100">
              {result.errors.map((item, index) => <li key={`${item.code}-${item.sourceRow}-${index}`}>{diagnosticLabel(item)}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-amber-200">Warnings</h3>
            <ul className="mt-2 max-h-44 space-y-1 overflow-auto text-sm text-amber-100">
              {result.warnings.map((item, index) => <li key={`${item.code}-${item.sourceRow}-${index}`}>{diagnosticLabel(item)}</li>)}
            </ul>
          </div>
        </div>
      ) : null}

      {result?.input && (
        <div className="space-y-5">
          <div className="space-y-4">
            {[...participantGroups.entries()].map(([category, participants]) => (
              <details key={category} className="rounded-2xl border border-slate-700 bg-slate-950/50" open={categories.length === 1}>
                <summary className="cursor-pointer px-4 py-3 font-semibold text-cyan-200">{category} — {participants.length} participants</summary>
                <div className="overflow-x-auto px-4 pb-4">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-slate-400"><tr><th className="p-2">Seed</th><th className="p-2">Nom</th><th className="p-2">Club / Pays</th><th className="p-2">Licence</th></tr></thead>
                    <tbody>{participants.map((participant) => (
                      <tr key={`${category}-${participant.seed}`} className="border-t border-slate-800 text-slate-200">
                        <td className="p-2">{participant.seed}</td><td className="p-2">{participant.name}</td>
                        <td className="p-2">{participant.country ?? '—'}</td><td className="p-2">{participant.license ?? '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>

          <div className="grid gap-4 rounded-2xl border border-slate-700 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => {
              const policy = policyFor(category);
              return <div key={category} className="rounded-xl border border-slate-700 bg-slate-950/50 p-3">
                <h3 className="font-semibold text-cyan-100">{category}</h3>
                <label className="mt-2 block text-xs text-slate-300">Format de base
                  <select aria-label={`${category} format de base`} value={policy.base_format} onChange={(e) => updatePolicy(category, { base_format: e.target.value as CategoryPlanningFormat })} className="mt-1 block w-full rounded-lg bg-slate-900 px-2 py-2">
                    <option value="elimination">Élimination directe</option><option value="repechage">Repêchage</option><option value="man_on_man">Man-on-Man</option>
                  </select>
                </label>
                <label className="mt-2 block text-xs text-slate-300">Transition
                  <select aria-label={`${category} transition`} value={policy.transition_round ?? ''} onChange={(e) => { const v = e.target.value; updatePolicy(category, v ? { transition_round: Number(v), transition_format: policy.transition_format ?? 'man_on_man' } : { transition_round: null, transition_format: null }); }} className="mt-1 block w-full rounded-lg bg-slate-900 px-2 py-2">
                    <option value="">Aucune</option><option value="2">À partir du Round 2</option><option value="3">À partir du Round 3</option><option value="4">À partir du Round 4</option>
                  </select>
                </label>
                {policy.transition_round != null && <label className="mt-2 block text-xs text-slate-300">Nouveau format
                  <select aria-label={`${category} transition format`} value={policy.transition_format ?? 'man_on_man'} onChange={(e) => updatePolicy(category, { transition_format: e.target.value as CategoryPlanningFormat })} className="mt-1 block w-full rounded-lg bg-slate-900 px-2 py-2"><option value="man_on_man">Man-on-Man</option><option value="elimination">Élimination directe</option><option value="repechage">Repêchage</option></select>
                </label>}
              </div>;
            })}
            </div>
            <button type="button" onClick={() => void savePolicies()} className="justify-self-start rounded-xl border border-cyan-600 px-4 py-2 font-semibold text-cyan-100">Enregistrer les politiques</button>
            {policyMessage && <p role="status" className="text-sm text-cyan-100">{policyMessage}</p>}
            <label className="text-sm text-slate-300">Format historique de preview
              <select aria-label="Format preview" value={format} onChange={(event) => { setFormat(event.target.value as FormatType); setPreviews({}); setPreflightState('IDLE'); setPreflightResults({}); setPreflightError(null); setPersistenceState('IDLE'); setPersistenceMessage(null); setUiState('VALID'); }} className="mt-2 block w-full rounded-xl bg-slate-950 px-3 py-2">
                <option value="single-elim">Élimination directe</option><option value="repechage">Repêchage</option>
              </select>
            </label>
            <button type="button" onClick={generatePreview} className="justify-self-start rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white hover:bg-cyan-500">Générer les previews ({categories.length} catégories)</button>
          </div>
        </div>
      )}

      {hasPreviews && (
        <div className="space-y-6">
          {categories.map((category) => {
            const preview = previews[category];
            if (!preview) return null;
            return (
              <div key={category} className="space-y-3">
                <h3 className="text-lg font-semibold text-cyan-100 border-b border-cyan-800 pb-2">{category}</h3>
                <BracketPreview rounds={preview.rounds} repechage={preview.repechage} onExportPdf={() => undefined} onExportCsv={() => undefined} showExportActions={false} />
              </div>
            );
          })}
        </div>
      )}

      {hasPreviews && (
        <div data-testid="planning-safety-preflight" className={`rounded-2xl border p-4 ${preflightState === 'SAFE' ? 'border-emerald-500 bg-emerald-500/10' : preflightState === 'BLOCKED' ? 'border-red-500 bg-red-500/10' : 'border-amber-500 bg-amber-500/10'}`}>
          <h3 className="font-semibold text-white">Sécurité planning serveur : {preflightState}</h3>
          {preflightState === 'CHECKING' && <p className="mt-2 text-sm text-slate-300">Vérification transactionnelle des heats ciblés…</p>}
          {preflightError && <p role="alert" className="mt-2 text-sm text-amber-100">{preflightError}</p>}
          {totalReplacedHeatCount === 0 && <p className="mt-2 text-sm text-emerald-100">Aucun heat existant ciblé.</p>}
          
          {Object.entries(preflightResults).map(([category, result]) => 
            result.targetedHeats.map((heat) => (
              <div key={`${category}-${heat.heatId}`} className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-200">
                <strong>{category} : {heat.heatId}</strong> — statut {heat.status}
                <div className="mt-1 grid gap-1 sm:grid-cols-3">
                  <span>scores: {heat.scoreCount}</span><span>overrides: {heat.overrideCount}</span><span>interférences: {heat.interferenceCount}</span>
                  <span>juges: {heat.judgeAssignmentCount}</span><span>timers: {heat.timerCount}</span><span>historique: {heat.historyCount}</span>
                  <span>actif: {heat.isActive ? 'oui' : 'non'}</span><span>pointeurs: {heat.activePointerCount}</span>
                </div>
                {heat.blockerReasons.length > 0 && <p className="mt-2 text-red-200">Raisons : {heat.blockerReasons.join(', ')}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {hasPreviews && (
        <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200">
          <input
            aria-label="Remplacer tous les heats préparatoires"
            type="checkbox"
            checked={overwrite}
            disabled={persistenceState === 'PERSISTING'}
            onChange={(event) => {
              const nextOverwrite = event.target.checked;
              setOverwrite(nextOverwrite);
              setPreflightState('CHECKING');
              setPreflightResults({});
              setPreflightError(null);
              setPersistenceState('IDLE');
              setPersistenceMessage(null);
              void runPreflight(categories, nextOverwrite);
            }}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Remplacer tous les heats préparatoires existants.
            <span className="mt-1 block text-xs text-slate-400">
              Sans cette option, seules les collisions d’ID propres peuvent être remplacées. Toute donnée sportive bloque l’opération.
            </span>
          </span>
        </label>
      )}

      {persistenceState === 'CONFIRMING' && hasPreviews && (
        <div role="dialog" aria-label="Confirmation création planning" className="rounded-2xl border border-cyan-500 bg-cyan-500/10 p-4 text-sm text-slate-100">
          <h3 className="font-semibold text-white">Confirmer la création globale du planning</h3>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div><dt className="text-slate-400">Événement</dt><dd>{eventName ?? `#${eventId}`}</dd></div>
            <div><dt className="text-slate-400">Catégories</dt><dd>{categories.length}</dd></div>
            <div><dt className="text-slate-400">Participants</dt><dd>{totalParticipantCount}</dd></div>
            <div><dt className="text-slate-400">Heats au total</dt><dd>{totalHeatCount}</dd></div>
            <div><dt className="text-slate-400">Format</dt><dd>{format}</dd></div>
            <div><dt className="text-slate-400">Overwrite</dt><dd>{overwrite ? 'true' : 'false'}</dd></div>
            <div><dt className="text-slate-400">Preflight</dt><dd>SAFE</dd></div>
            <div><dt className="text-slate-400">Heats ciblés</dt><dd>{totalReplacedHeatCount}</dd></div>
          </dl>
          <p className="mt-3 text-amber-100">
            {overwrite
              ? 'Les heats préparatoires existants seront remplacés. Les heats contenant des données sportives sont protégés et bloqueront l’opération.'
              : 'Les collisions d’identifiants propres peuvent être remplacées. Les heats contenant des données sportives sont protégés et bloqueront l’opération.'}
          </p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => void persistPlanning()} className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white">Confirmer et créer ({categories.length} catégories)</button>
            <button type="button" onClick={() => setPersistenceState('IDLE')} className="rounded-xl border border-slate-600 px-4 py-2">Annuler</button>
          </div>
        </div>
      )}

      {persistenceMessage && (
        <div role="status" className={`rounded-xl border p-3 text-sm ${persistenceState === 'SUCCESS' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-100' : 'border-red-500 bg-red-500/10 text-red-100'}`}>
          {persistenceMessage}
        </div>
      )}

      <button
        type="button"
        data-testid="persist-planning-button"
        disabled={!canPersist}
        onClick={requestConfirmation}
        className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
      >
        {persistenceState === 'PERSISTING' ? 'Création en cours…' : 'Créer les heats sur cet événement'}
      </button>
    </section>
  );
}
