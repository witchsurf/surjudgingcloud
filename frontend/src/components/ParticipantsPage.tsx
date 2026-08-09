import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parsePlanningCsv } from '../adapters/planningImport/csvParser';
import PlanningImportPanel from './PlanningImportPanel';
import { supabase } from '../lib/supabase';
import { canProceedToParticipants, parseCanonicalEventId, resolveEventWorkflowState } from '../domain/eventWorkflow';
import { getDeploymentMode } from '../domain/deploymentMode';

interface Participant {
  seed: number;
  name: string;
  country: string;
  license: string;
  category: string;
}

const ParticipantsPage = () => {
  const navigate = useNavigate();
  const deploymentMode = getDeploymentMode();
  const [searchParams] = useSearchParams();
  const eventIdParam = searchParams.get('event') ?? searchParams.get('eventId');
  const storedEventData = (() => {
    try { return JSON.parse(localStorage.getItem('eventData') || 'null'); } catch { return null; }
  })();
  const previewEventId = parseCanonicalEventId(eventIdParam) ?? parseCanonicalEventId(storedEventData?.eventDbId);
  const previewEventName = searchParams.get('eventName')?.trim() || undefined;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Toutes les catégories');
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [showOfflinePreview, setShowOfflinePreview] = useState(false);
  const [workflowReady, setWorkflowReady] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState('Vérification de l’événement…');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('participants');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setParticipants(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const verifyEvent = async () => {
      if (!previewEventId || !supabase) {
        if (!cancelled) {
          setWorkflowReady(false);
          setWorkflowStatus('Événement non sauvegardé dans la base : aucune écriture autorisée.');
        }
        return;
      }
      const { data, error } = await supabase
        .from('events')
        .select('id, name, paid, status, method, test_activated_at, test_activated_by')
        .eq('id', previewEventId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setWorkflowReady(false);
        setWorkflowStatus('Événement introuvable en base : import et génération bloqués.');
        return;
      }
      const state = resolveEventWorkflowState(data);
      const ready = canProceedToParticipants(state, deploymentMode);
      setWorkflowReady(ready);
      setWorkflowStatus(ready
        ? `Événement sauvegardé dans la base ${deploymentMode === 'field' ? 'locale' : 'Cloud'} — ID ${state.eventId}${state.paymentStatus === 'test_activated' ? ' (activation test)' : ''}`
        : `Événement Cloud sauvegardé — ID ${state.eventId}, paiement ou activation test autorisée requis.`);
    };
    void verifyEvent();
    return () => { cancelled = true; };
  }, [deploymentMode, previewEventId]);

  const toLegacyParticipants = (csv: string, source: 'csv' | 'google_sheets'): Participant[] => {
    const result = parsePlanningCsv(csv, { source });
    if (result.errors.length > 0) {
      throw new Error(result.errors.map((diagnostic) => diagnostic.message).join('\n'));
    }
    return result.validRows.map((row) => ({
      seed: row.seed,
      name: row.name,
      country: row.country ?? '',
      license: row.license ?? '',
      category: row.category,
    }));
  };

  const persistParticipants = (list: Participant[]) => {
    setParticipants(list);
    try {
      localStorage.setItem('participants', JSON.stringify(list));
    } catch {
      // ignore quota errors
    }
  };

  const handleGoogleSheetImport = async () => {
    if (deploymentMode === 'field') {
      setImportError('Google Sheets est désactivé en mode Field. Utilisez un fichier local CSV/XLSX.');
      return;
    }
    const sheetIdMatch = googleSheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      setImportError('URL Google Sheet invalide. Assurez-vous de coller un lien de feuille partagé en lecture.');
      return;
    }

    setImportError(null);
    setIsImporting(true);
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetIdMatch[1]}/gviz/tq?tqx=out:csv`;
      const response = await fetch(csvUrl);
      if (!response.ok) {
        throw new Error(`Impossible de récupérer les données (code ${response.status}).`);
      }
      const text = await response.text();
      const parsed = toLegacyParticipants(text, 'google_sheets');
      if (parsed.length === 0) {
        throw new Error('Aucun participant détecté dans la feuille (vérifiez l’en-tête et le partage public).');
      }
      persistParticipants(parsed);
    } catch (error) {
      console.error('Erreur import Google Sheet:', error);
      setImportError(error instanceof Error ? error.message : 'Échec de l’import Google Sheet.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleCsvFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setIsImporting(true);
    try {
      const text = await file.text();
      const parsed = toLegacyParticipants(text, 'csv');
      if (parsed.length === 0) {
        throw new Error('Aucun participant détecté dans le fichier CSV.');
      }
      persistParticipants(parsed);
    } catch (error) {
      console.error('Erreur import CSV:', error);
      setImportError(error instanceof Error ? error.message : 'Échec de l’import CSV.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerateHeats = () => {
    if (!workflowReady || !previewEventId) {
      setImportError('Création des heats interdite : événement non sauvegardé ou non activé.');
      return;
    }
    if (participants.length === 0) {
      setImportError('Importez ou ajoutez des participants avant de générer les séries.');
      return;
    }
    navigate(`/generate-heats?eventId=${previewEventId}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Participants et Structure d'Événement</h1>
          <p className="text-gray-400">
            Importez vos participants, gérez les inscriptions et générez automatiquement vos séries.
          </p>
          <p className={`mt-3 rounded-lg border px-4 py-3 text-sm ${workflowReady ? 'border-emerald-600 bg-emerald-500/10 text-emerald-200' : 'border-amber-600 bg-amber-500/10 text-amber-200'}`}>
            {workflowStatus}
          </p>
        </div>

        {/* Import Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-1">Import historique</h2>
          <p className="mb-4 text-sm text-amber-300">{deploymentMode === 'cloud' ? 'Workflow legacy CSV / Google Sheets conservé pour rollback.' : 'Mode Field : seuls les imports de fichiers locaux sont autorisés.'} L’import hors ligne ci-dessous est recommandé sur le terrain.</p>
          
          <div className="flex gap-4 mb-6">
            <button
              className="bg-blue-600 px-6 py-2 rounded-lg hover:bg-blue-700"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              CSV
            </button>
            {deploymentMode === 'cloud' && <button className="bg-gray-700 px-6 py-2 rounded-lg hover:bg-gray-600" type="button">Google Sheets</button>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvFileChange}
          />

          {deploymentMode === 'cloud' && <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Partagez votre Google Sheet en mode public puis collez l'URL ici.
            </p>
            <div className="flex gap-4">
              <input
                type="text"
                value={googleSheetUrl}
                onChange={(e) => {
                  setGoogleSheetUrl(e.target.value);
                  setImportError(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 focus:border-blue-500"
              />
              <button
                onClick={handleGoogleSheetImport}
                className="bg-blue-600 px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isImporting}
              >
                {isImporting ? 'Import...' : 'Importer'}
              </button>
            </div>
            {importError && (
              <p className="text-sm text-red-400">{importError}</p>
            )}
          </div>}
        </div>

        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowOfflinePreview((visible) => !visible)}
            className="rounded-lg border border-cyan-600 px-5 py-2 text-cyan-200 hover:bg-cyan-500/10"
          >
            {showOfflinePreview ? 'Fermer l’import hors ligne recommandé' : 'Ouvrir l’import hors ligne recommandé'}
          </button>
          {showOfflinePreview && (
            <div className="mt-4">
              <PlanningImportPanel
                eventId={workflowReady ? previewEventId : null}
                eventName={previewEventName}
                onPersisted={({ participants: persisted }) => persistParticipants(persisted.map((participant) => ({
                  seed: participant.seed,
                  name: participant.name,
                  country: participant.country ?? '',
                  license: participant.license ?? '',
                  category: participant.category,
                })))}
              />
            </div>
          )}
        </div>

        {/* Participants List */}
        <div className="bg-gray-800 rounded-lg overflow-hidden mb-8">
          <div className="p-6 border-b border-gray-700">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Participants</h2>
              <div className="flex gap-4">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded-lg px-4 py-2"
                >
                  <option>Toutes les catégories</option>
                  {[...new Set(participants.map(p => p.category))].map(cat => (
                    <option key={cat}>{cat}</option>
                  ))}
                </select>
                <button className="bg-blue-600 px-4 py-2 rounded-lg hover:bg-blue-700">
                  Exporter CSV
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Seed
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Nom
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Pays / Club
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Licence
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Catégorie
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {(selectedCategory === 'Toutes les catégories'
                  ? participants
                  : participants.filter((p) => p.category === selectedCategory)
                ).map((participant) => (
                  <tr key={participant.seed}>
                    <td className="px-6 py-4 whitespace-nowrap">{participant.seed}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{participant.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{participant.country}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{participant.license}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{participant.category}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button className="text-blue-400 hover:text-blue-300 mr-3">
                        Éditer
                      </button>
                      <button className="text-red-400 hover:text-red-300">
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-between">
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-2 rounded-lg border border-gray-700 hover:border-gray-600"
          >
            Retour
          </button>
          <button
            onClick={handleGenerateHeats}
            disabled={!workflowReady}
            className="bg-blue-600 px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Générer les séries →
          </button>
        </div>
      </div>
    </div>
  );
};

export default ParticipantsPage;
