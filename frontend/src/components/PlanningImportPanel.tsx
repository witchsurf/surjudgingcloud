import { useMemo, useRef, useState } from 'react';
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
  const [uiState, setUiState] = useState<ImportUiState>('IDLE');
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<LocalFileType | null>(null);
  const [result, setResult] = useState<PlanningImportParseResult | null>(null);
  const [xlsxMetadata, setXlsxMetadata] = useState<XlsxMetadata | null>(null);
  const [selectedWorksheet, setSelectedWorksheet] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [format, setFormat] = useState<FormatType>('single-elim');
  const [preview, setPreview] = useState<ComputeResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [preflightState, setPreflightState] = useState<'IDLE' | 'CHECKING' | 'SAFE' | 'BLOCKED' | 'UNKNOWN'>('IDLE');
  const [preflightResult, setPreflightResult] = useState<PlanningSafetyPreflightResult | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>('IDLE');
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const persistingRef = useRef(false);

  const participantGroups = useMemo(
    () => groupParticipants(result?.validRows ?? []),
    [result],
  );
  const categories = useMemo(() => [...participantGroups.keys()], [participantGroups]);

  const applyResult = (
    nextResult: PlanningImportParseResult,
    metadata: XlsxMetadata | null,
  ) => {
    setResult(nextResult);
    setXlsxMetadata(metadata);
    setPreview(null);
    setPreflightState('IDLE');
    setPreflightResult(null);
    setPreflightError(null);
    setPersistenceState('IDLE');
    setPersistenceMessage(null);
    setSelectedCategory(nextResult.validRows[0]?.category ?? '');
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
    setPreview(null);
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
    setSelectedCategory('');
    setPreview(null);
    if (!nextFile) {
      setFileType(null);
      setUiState('IDLE');
      return;
    }
    await parseLocalFile(nextFile);
  };

  const runPreflight = async (category: string, overwriteValue = overwrite) => {
    if (!eventId || !Number.isSafeInteger(eventId) || eventId <= 0) {
      setPreflightState('UNKNOWN');
      setPreflightError('Événement absent ou invalide : la sécurité planning ne peut pas être déclarée SAFE.');
      return;
    }
    setPreflightState('CHECKING');
    setPreflightResult(null);
    setPreflightError(null);
    try {
      const safety = await planningSafetyRepository.preflight({
        eventId, category, proposedHeatIds: [], overwrite: overwriteValue,
      });
      setPreflightResult(safety);
      setPreflightState(safety.state);
    } catch (cause) {
      setPreflightState('UNKNOWN');
      setPreflightError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const generatePreview = () => {
    if (!result?.input || !selectedCategory) return;
    const participants = participantGroups.get(selectedCategory) ?? [];
    try {
      setPersistenceState('IDLE');
      setPersistenceMessage(null);
      setPreview(computeHeats(participants, { format, preferredHeatSize: 'auto', variant: 'V1' }));
      setFatalError(null);
      setUiState('PREVIEW_READY');
      void runPreflight(selectedCategory);
    } catch (cause) {
      setFatalError(cause instanceof Error ? cause.message : String(cause));
      setUiState('ERROR');
    }
  };

  const participantCount = participantGroups.get(selectedCategory)?.length ?? 0;
  const heatCount = preview?.rounds.reduce((total, round) => total + round.heats.length, 0) ?? 0;
  const replacedHeatCount = preflightResult?.targetedHeats.length ?? 0;
  const validEventId = Number.isSafeInteger(eventId) && Number(eventId) > 0;
  const canPersist = Boolean(
    result?.input
    && preview
    && validEventId
    && selectedCategory
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
    if (!canPersist || !result?.input || !preview || !eventId || persistingRef.current) return;
    persistingRef.current = true;
    setPersistenceState('PERSISTING');
    setPersistenceMessage(null);
    try {
      await persistPlanningImportSafely({
        input: result.input,
        preview,
        eventId,
        eventName,
        category: selectedCategory,
        format,
        overwrite,
      });
      setPersistenceState('SUCCESS');
      setPersistenceMessage(`Planning créé avec succès — ${selectedCategory}, ${heatCount} heats, ${participantCount} participants — ${new Date().toLocaleString('fr-FR')}`);
      onPersisted?.({
        category: selectedCategory,
        participantCount,
        heatCount,
        participants: participantGroups.get(selectedCategory) ?? [],
      });
    } catch (cause) {
      const error = cause as { code?: string; message?: string; details?: string };
      if (error?.code === 'PGRST202') {
        setPersistenceState('ERROR');
        setPersistenceMessage('Le serveur local doit être mis à jour avant de créer les heats. Aucun fallback legacy n’a été tenté.');
      } else if (`${error?.message ?? ''} ${error?.details ?? ''}`.includes('HEAT_PLANNING_BLOCKED')) {
        setPersistenceState('BLOCKED');
        setPreflightState('BLOCKED');
        setPreflightResult(null);
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

  return (
    <section data-testid="planning-import-panel" className="space-y-5 rounded-3xl border border-cyan-700/60 bg-slate-900/80 p-6 shadow-xl shadow-cyan-500/10">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Nouvel import hors ligne</h2>
          <span className="rounded-full border border-emerald-500/70 px-3 py-1 text-xs font-semibold text-emerald-200">Workflow recommandé</span>
        </div>
        <p className="mt-2 text-sm text-slate-400">CSV ou XLSX local → diagnostics → preview → contrôle serveur SAFE → création atomique sur le HP.</p>
      </header>

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

          <div className="grid gap-4 rounded-2xl border border-slate-700 p-4 md:grid-cols-3">
            <label className="text-sm text-slate-300">Catégorie
              <select aria-label="Catégorie preview" value={selectedCategory} onChange={(event) => { setSelectedCategory(event.target.value); setPreview(null); setPreflightState('IDLE'); setPreflightResult(null); setPreflightError(null); setPersistenceState('IDLE'); setPersistenceMessage(null); setUiState('VALID'); }} className="mt-2 block w-full rounded-xl bg-slate-950 px-3 py-2">
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-300">Format
              <select aria-label="Format preview" value={format} onChange={(event) => { setFormat(event.target.value as FormatType); setPreview(null); setPreflightState('IDLE'); setPreflightResult(null); setPreflightError(null); setPersistenceState('IDLE'); setPersistenceMessage(null); setUiState('VALID'); }} className="mt-2 block w-full rounded-xl bg-slate-950 px-3 py-2">
                <option value="single-elim">Élimination directe</option><option value="repechage">Repêchage</option>
              </select>
            </label>
            <button type="button" onClick={generatePreview} className="self-end rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white hover:bg-cyan-500">Générer la preview en mémoire</button>
          </div>
        </div>
      )}

      {preview && <BracketPreview rounds={preview.rounds} repechage={preview.repechage} onExportPdf={() => undefined} onExportCsv={() => undefined} showExportActions={false} />}

      {preview && (
        <div data-testid="planning-safety-preflight" className={`rounded-2xl border p-4 ${preflightState === 'SAFE' ? 'border-emerald-500 bg-emerald-500/10' : preflightState === 'BLOCKED' ? 'border-red-500 bg-red-500/10' : 'border-amber-500 bg-amber-500/10'}`}>
          <h3 className="font-semibold text-white">Sécurité planning serveur : {preflightState}</h3>
          {preflightState === 'CHECKING' && <p className="mt-2 text-sm text-slate-300">Vérification transactionnelle des heats ciblés…</p>}
          {preflightError && <p role="alert" className="mt-2 text-sm text-amber-100">{preflightError}</p>}
          {preflightResult && preflightResult.targetedHeats.length === 0 && <p className="mt-2 text-sm text-emerald-100">Aucun heat existant ciblé.</p>}
          {preflightResult?.targetedHeats.map((heat) => (
            <div key={heat.heatId} className="mt-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-200">
              <strong>{heat.heatId}</strong> — statut {heat.status}
              <div className="mt-1 grid gap-1 sm:grid-cols-3">
                <span>scores: {heat.scoreCount}</span><span>overrides: {heat.overrideCount}</span><span>interférences: {heat.interferenceCount}</span>
                <span>juges: {heat.judgeAssignmentCount}</span><span>timers: {heat.timerCount}</span><span>historique: {heat.historyCount}</span>
                <span>actif: {heat.isActive ? 'oui' : 'non'}</span><span>pointeurs: {heat.activePointerCount}</span>
              </div>
              {heat.blockerReasons.length > 0 && <p className="mt-2 text-red-200">Raisons : {heat.blockerReasons.join(', ')}</p>}
            </div>
          ))}
        </div>
      )}

      {preview && (
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
              setPreflightResult(null);
              setPreflightError(null);
              setPersistenceState('IDLE');
              setPersistenceMessage(null);
              void runPreflight(selectedCategory, nextOverwrite);
            }}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Remplacer tous les heats préparatoires existants de cette catégorie.
            <span className="mt-1 block text-xs text-slate-400">
              Sans cette option, seules les collisions d’ID propres peuvent être remplacées. Toute donnée sportive bloque l’opération.
            </span>
          </span>
        </label>
      )}

      {persistenceState === 'CONFIRMING' && preview && (
        <div role="dialog" aria-label="Confirmation création planning" className="rounded-2xl border border-cyan-500 bg-cyan-500/10 p-4 text-sm text-slate-100">
          <h3 className="font-semibold text-white">Confirmer la création du planning</h3>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div><dt className="text-slate-400">Événement</dt><dd>{eventName ?? `#${eventId}`}</dd></div>
            <div><dt className="text-slate-400">Catégorie</dt><dd>{selectedCategory}</dd></div>
            <div><dt className="text-slate-400">Participants</dt><dd>{participantCount}</dd></div>
            <div><dt className="text-slate-400">Heats</dt><dd>{heatCount}</dd></div>
            <div><dt className="text-slate-400">Format</dt><dd>{format}</dd></div>
            <div><dt className="text-slate-400">Overwrite</dt><dd>{overwrite ? 'true' : 'false'}</dd></div>
            <div><dt className="text-slate-400">Preflight</dt><dd>SAFE</dd></div>
            <div><dt className="text-slate-400">Heats ciblés</dt><dd>{replacedHeatCount}</dd></div>
          </dl>
          <p className="mt-3 text-amber-100">
            {overwrite
              ? 'Les heats préparatoires existants de cette catégorie seront remplacés. Les heats contenant des données sportives sont protégés et bloqueront l’opération.'
              : 'Les collisions d’identifiants propres peuvent être remplacées. Les heats contenant des données sportives sont protégés et bloqueront l’opération.'}
          </p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => void persistPlanning()} className="rounded-xl bg-cyan-600 px-4 py-2 font-semibold text-white">Confirmer et créer</button>
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
