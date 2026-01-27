import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Participant {
  seed: number;
  name: string;
  country: string;
  license: string;
  category: string;
}

const ParticipantsPage = () => {
  const navigate = useNavigate();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Toutes les catégories');
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
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

  const normaliseHeader = (header: string) =>
    header.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  const splitCsvLine = (line: string) => {
    const regex = /("([^"]|"")*"|[^,]+)(?=,|$)/g;
    const matches = line.match(regex) || [];
    return matches.map((value) => value.replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim());
  };

  const parseCsvParticipants = (csv: string): Participant[] => {
    const rows = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (rows.length === 0) return [];

    const headers = splitCsvLine(rows[0]).map(normaliseHeader);
    const findIndex = (candidates: string[]) => {
      for (const candidate of candidates) {
        const idx = headers.findIndex((header) => header === candidate);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const seedIdx = findIndex(['seed', 'tete', 'ranking', 'rank']);
    const nameIdx = findIndex(['name', 'nom', 'surfer', 'surfeur']);
    const countryIdx = findIndex(['country', 'pays', 'club', 'team']);
    const licenseIdx = findIndex(['license', 'licence', 'id']);
    const categoryIdx = findIndex(['category', 'categorie', 'division']);

    return rows.slice(1).map((row, index) => {
      const values = splitCsvLine(row);
      const seedValue = seedIdx !== -1 ? Number(values[seedIdx]) : index + 1;
      return {
        seed: Number.isFinite(seedValue) ? seedValue : index + 1,
        name: nameIdx !== -1 ? values[nameIdx] : `Surfeur ${index + 1}`,
        country: countryIdx !== -1 ? values[countryIdx] : 'SENEGAL',
        license: licenseIdx !== -1 ? values[licenseIdx] : '',
        category: categoryIdx !== -1 ? values[categoryIdx] : 'OPEN'
      };
    }).filter((participant) => participant.name.trim().length > 0);
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
      const parsed = parseCsvParticipants(text);
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
      const parsed = parseCsvParticipants(text);
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
    if (participants.length === 0) {
      setImportError('Importez ou ajoutez des participants avant de générer les séries.');
      return;
    }
    navigate('/generate-heats');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Participants et Structure d'Événement</h1>
          <p className="text-gray-400">
            Importez vos participants, gérez les inscriptions et générez automatiquement vos séries.
          </p>
        </div>

        {/* Import Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Importer des participants</h2>
          
          <div className="flex gap-4 mb-6">
            <button
              className="bg-blue-600 px-6 py-2 rounded-lg hover:bg-blue-700"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              CSV
            </button>
            <button className="bg-gray-700 px-6 py-2 rounded-lg hover:bg-gray-600" type="button">
              Google Sheets
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvFileChange}
          />

          <div className="space-y-4">
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
          </div>
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
