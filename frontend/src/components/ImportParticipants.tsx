import { useState } from 'react';
import type { ParsedParticipant } from '../utils/csv';
import { parseCSVParticipants, buildGoogleSheetCsvUrl } from '../utils/csv';

interface ImportParticipantsProps {
  onImport: (rows: ParsedParticipant[]) => Promise<void> | void;
  disabled?: boolean;
}

type TabKey = 'google' | 'csv';

export default function ImportParticipants({ onImport, disabled }: ImportParticipantsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('google');
  const [sheetUrl, setSheetUrl] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleParsed = async (rows: ParsedParticipant[]) => {
    if (!rows.length) {
      setErrors(['Aucune ligne valide trouvée.']);
      return;
    }
    await onImport(rows);
    setStatus(`${rows.length} participants importés.`);
  };

  const handleImportGoogle = async () => {
    setErrors([]);
    setStatus(null);

    const csvUrl = buildGoogleSheetCsvUrl(sheetUrl);
    if (!csvUrl) {
      setErrors(['URL Google Sheets invalide ou non publique.']);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(csvUrl);
      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}`);
      }
      const text = await response.text();
      const parsed = parseCSVParticipants(text);
      if (parsed.errors.length) setErrors(parsed.errors);
      await handleParsed(parsed.rows);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Import impossible']);
    } finally {
      setLoading(false);
    }
  };

  const handleImportCsv = async (file: File | null) => {
    setErrors([]);
    setStatus(null);
    if (!file) {
      setErrors(['Veuillez choisir un fichier CSV.']);
      return;
    }

    try {
      setLoading(true);
      const text = await file.text();
      const parsed = parseCSVParticipants(text);
      if (parsed.errors.length) setErrors(parsed.errors);
      await handleParsed(parsed.rows);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Lecture du fichier impossible']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-blue-500/10">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h2 className="text-lg font-semibold text-white">Importer des participants</h2>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setActiveTab('google')}
            className={`rounded-full px-4 py-1.5 ${activeTab === 'google' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            Google Sheets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('csv')}
            className={`rounded-full px-4 py-1.5 ${activeTab === 'csv' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            CSV
          </button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-6 text-slate-200 sm:px-6">
        {activeTab === 'google' ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Partagez votre Google Sheet en mode public puis collez l&apos;URL ici.
            </p>
            <input
              type="url"
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
            />
            <button
              type="button"
              disabled={disabled || loading}
              onClick={handleImportGoogle}
              className="inline-flex items-center rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white shadow shadow-blue-500/25 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? 'Import...' : 'Importer'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="file"
              accept=".csv"
              disabled={disabled || loading}
              onChange={(event) => handleImportCsv(event.target.files?.[0] ?? null)}
              className="w-full cursor-pointer rounded-2xl border border-dashed border-slate-700 bg-slate-900 px-4 py-6 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
            />
            <p className="text-xs text-slate-400">Colonnes attendues: seed, name, category, country (optionnel), license (optionnel).</p>
          </div>
        )}

        {status && <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</p>}
        {errors.length > 0 && (
          <div className="space-y-2 rounded-xl border border-red-400/70 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errors.map((err) => (
              <p key={err}>{err}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
