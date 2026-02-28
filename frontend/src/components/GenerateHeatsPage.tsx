import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createHeatsWithEntries } from '../api/supabaseClient';
import { generatePreviewHeats } from '../utils/heatGeneration';
import EventStatus from './EventStatus';
import { useConfigStore } from '../stores/configStore';

interface Heat {
  round: number;
  heat_number: number;
  division?: string;
  surfers: {
    color: string;
    name: string;
    country: string;
  }[];
}

interface ParticipantRecord {
  seed?: number;
  name: string;
  country?: string;
  license?: string;
  category?: string;
  [key: string]: unknown;
}

interface CategoryPreview {
  category: string;
  participants: ParticipantRecord[];
  rounds: { round: number; heats: Heat[] }[];
  seriesSize: number;
}

const GenerateHeatsPage = () => {
  const navigate = useNavigate();
  const { setActiveEventId, setConfig, setConfigSaved } = useConfigStore();
  const [selectedFormat, setSelectedFormat] = useState<'elimination' | 'repechage'>('elimination');
  const [roundFormat, setRoundFormat] = useState('heats-3');
  const [seriesSize, setSeriesSize] = useState('auto');
  const [previewData, setPreviewData] = useState<CategoryPreview[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);

  useEffect(() => {
    // Try multiple sources for the event ID
    const storedEventId = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');

    if (!storedEventId) {
      alert('Aucun événement sélectionné. Veuillez créer ou sélectionner un événement.');
      navigate('/my-events');
      return;
    }
    setEventId(storedEventId);

    try {
      const saved = JSON.parse(localStorage.getItem('participants') || '[]');
      if (Array.isArray(saved)) {
        setParticipants(saved);
      }
    } catch (error) {
      console.warn('Impossible de charger les participants:', error);
      setParticipants([]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getSeriesSize = () => {
    if (seriesSize === 'auto') {
      return roundFormat === 'man-on-man' ? 2 : 4;
    }
    return Math.max(1, parseInt(seriesSize, 10) || 2);
  };

  const handlePreview = () => {
    if (!eventId) {
      alert('Aucun événement sélectionné. Veuillez créer ou sélectionner un événement.');
      navigate('/my-events');
      return;
    }

    try {
      const stored = JSON.parse(localStorage.getItem('participants') || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        const grouped = stored.reduce<Record<string, ParticipantRecord[]>>((acc, participant) => {
          const rawCategory =
            (participant.category ||
              (participant as ParticipantRecord).division ||
              'OPEN') as string;
          const category = rawCategory?.trim() || 'OPEN';
          if (!acc[category]) acc[category] = [];
          acc[category].push(participant as ParticipantRecord);
          return acc;
        }, {});

        const preview = Object.entries(grouped)
          .map(([category, list]) => {
            const baseSeriesSize = getSeriesSize();
            const computedSeriesSize = Math.max(
              1,
              Math.min(baseSeriesSize, list.length || baseSeriesSize)
            );
            const rounds = generatePreviewHeats(
              list,
              selectedFormat,
              computedSeriesSize
            ).map(round => ({
              round: round.round,
              heats: round.heats.map(heat => ({
                ...heat,
                division: category
              }))
            }));
            return {
              category,
              participants: list,
              rounds,
              seriesSize: computedSeriesSize
            };
          })
          .sort((a, b) => a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }));

        setPreviewData(preview);
        return;
      }
    } catch (error) {
      console.error('Erreur lors de la génération des heats:', error);
    }

    setPreviewData([
      {
        category: 'DEMO',
        participants: [],
        seriesSize: getSeriesSize(),
        rounds: [
          {
            round: 1,
            heats: [
              {
                round: 1,
                heat_number: 1,
                division: 'DEMO',
                surfers: [
                  { color: 'ROUGE', name: 'Aly', country: 'GABON' },
                  { color: 'BLANC', name: 'Ouedraogo', country: 'BURKINA' },
                  { color: 'JAUNE', name: 'Simon', country: 'SIERALEONE' },
                  { color: 'BLEU', name: 'Noah', country: 'CAP VERT' }
                ]
              }
            ]
          }
        ]
      }
    ]);
  };

  const handleConfirm = async () => {
    try {
      // Robust ID retrieval: State -> Active Key -> Legacy Key
      let currentEventId = eventId;
      if (!currentEventId) {
        currentEventId = localStorage.getItem('surfJudgingActiveEventId') || localStorage.getItem('eventId');
      }

      if (!currentEventId) {
        console.error('Event ID missing. Keys checked: surfJudgingActiveEventId, eventId');
        throw new Error('Aucun événement sélectionné (ID introuvable). Veuillez retourner à "Mes événements" et sélectionner "Continuer".');
      }

      if (previewData.length === 0) throw new Error('Aucune série générée');
      if (!participants || participants.length === 0) {
        throw new Error(
          'Aucun participant trouvé — importez d\'abord les participants depuis la page Participants.'
        );
      }

      for (const categoryPreview of previewData) {
        // Build participants map for the API
        const participantsBySeed = new Map<number, any>();
        categoryPreview.participants.forEach((p: any) => {
          if (typeof p.seed === 'number') {
            participantsBySeed.set(p.seed, p);
          }
        });

        const numericEventId = parseInt(currentEventId, 10);
        if (!numericEventId || isNaN(numericEventId) || numericEventId <= 0) {
          throw new Error(`ID d'événement invalide (${currentEventId}). Veuillez recharger la page.`);
        }

        await createHeatsWithEntries(
          numericEventId,
          (() => {
            const ev = JSON.parse(localStorage.getItem('eventData') || 'null');
            return ev?.name || 'Competition';
          })(),
          categoryPreview.category,
          categoryPreview.rounds.map((r: any) => ({
            name: `Round ${r.round}`,
            roundNumber: r.round,
            heats: r.heats.map((h: any) => ({
              heatNumber: h.heat_number,
              slots: h.surfers.map((s: any) => {
                const isPlaceholder = s.name && (
                  s.name.startsWith('Qualifié') ||
                  s.name.startsWith('Winner') ||
                  s.name.startsWith('Repêchage') ||
                  s.name.startsWith('Finaliste') ||
                  s.name.match(/^R\d+-H\d+/)
                );
                return {
                  seed: typeof s.seed === 'number' ? s.seed : null,
                  name: s.name,
                  placeholder: isPlaceholder ? s.name : null
                };
              })
            }))
          })),
          participantsBySeed,
          { overwrite: true }
        );
      }

      const snapshot = {
        eventId,
        categories: previewData,
        metadata: {
          format: selectedFormat,
          seriesSize,
          roundFormat,
          createdAt: new Date().toISOString()
        }
      };
      localStorage.setItem('heats', JSON.stringify(snapshot));

      const firstCategory = previewData[0];
      const firstRound = firstCategory.rounds[0];
      const firstHeat = firstRound?.heats[0];
      let competitionName: string | null = eventId;
      try {
        const eventData = JSON.parse(localStorage.getItem('eventData') || 'null');
        if (eventData?.name) competitionName = eventData.name;
      } catch {
        // ignore
      }
      const configPayload = {
        competition: competitionName || eventId || 'Event',
        division: firstCategory.category,
        round: firstHeat?.round ?? 1,
        heatId: firstHeat?.heat_number ?? 1,
        judges: ['J1', 'J2', 'J3'],
        surfers: firstHeat ? firstHeat.surfers.map(s => s.color) : ['ROUGE', 'BLANC'],
        waves: 15,
        judgeNames: {},
        surferNames: firstHeat
          ? Object.fromEntries(
            firstHeat.surfers.map((surfer) => [
              surfer.color.toUpperCase(),
              surfer.name,
            ])
          )
          : {},
        surferCountries: firstHeat
          ? Object.fromEntries(
            firstHeat.surfers.map((surfer) => [
              surfer.color.toUpperCase(),
              surfer.country || '',
            ])
          )
          : {},
        tournamentType: selectedFormat,
        totalSurfers: participants.length,
        surfersPerHeat: firstHeat?.surfers.length ?? getSeriesSize(),
        totalHeats: previewData.reduce(
          (sum, category) =>
            sum +
            category.rounds.reduce(
              (acc, round) => acc + round.heats.length,
              0
            ),
          0
        ),
        totalRounds: previewData.reduce(
          (sum, category) => sum + category.rounds.length,
          0
        )
      };

      localStorage.setItem('surfJudgingConfig', JSON.stringify(configPayload));
      localStorage.setItem('surfJudgingConfigSaved', 'true');

      // Set activeEventId in context so ChiefJudgeWrapper loads from DB
      const numericId = parseInt(currentEventId, 10);
      if (numericId && !isNaN(numericId)) {
        setActiveEventId(numericId);
        setConfig(configPayload);
        setConfigSaved(true);
      }

      navigate('/chief-judge');
    } catch (error: any) {
      console.error('Erreur lors de la sauvegarde:', error);
      const message = error?.message || error?.error_description || JSON.stringify(error);
      alert(
        `Erreur lors de la sauvegarde : ${message}`
      );
    }
  };

  const totalHeats = useMemo(
    () =>
      previewData.reduce(
        (sum, category) =>
          sum + category.rounds.reduce((acc, round) => acc + round.heats.length, 0),
        0
      ),
    [previewData]
  );

  const handleExportPDF = () => {
    if (previewData.length === 0) return;

    // Récupération des données de l'événement
    const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
    const eventName = eventData.name || 'Compétition de Surf';
    const organizer = eventData.organizer || 'Organisateur non spécifié';
    const startDate = eventData.start_date ? new Date(eventData.start_date).toLocaleDateString('fr-FR') : '';
    const endDate = eventData.end_date ? new Date(eventData.end_date).toLocaleDateString('fr-FR') : '';
    const dateRange = startDate ? (endDate && startDate !== endDate ? `${startDate} au ${endDate}` : startDate) : 'Date non définie';

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Helper pour centrer le texte
    const centerText = (text: string, y: number) => {
      const textWidth = doc.getTextWidth(text);
      doc.text(text, (pageWidth - textWidth) / 2, y);
    };

    // --- EN-TÊTE (Header) ---
    const drawHeader = () => {
      doc.setFillColor(245, 247, 250); // Gris très clair / bleuté
      doc.rect(0, 0, pageWidth, 45, 'F');

      doc.setFontSize(20);
      doc.setTextColor(26, 86, 219); // Bleu primaire
      doc.setFont('helvetica', 'bold');
      centerText(eventName.toUpperCase(), 18);

      doc.setFontSize(12);
      doc.setTextColor(75, 85, 99); // Gris foncé
      doc.setFont('helvetica', 'bold');
      centerText('PLAN DES SÉRIES (HEATS)', 26);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128); // Gris moyen
      centerText(`Organisé par : ${organizer}`, 33);
      centerText(`Dates : ${dateRange}`, 38);

      // Ligne de séparation décorative
      doc.setDrawColor(26, 86, 219);
      doc.setLineWidth(0.5);
      doc.line(20, 45, pageWidth - 20, 45);
    };

    let cursorY = 55; // Démarrage sous le header

    // Dessiner le header sur la première page
    drawHeader();

    previewData.forEach((category) => {
      // Saut de page si pas assez de place pour le titre de catégorie
      if (cursorY > pageHeight - 40) {
        doc.addPage();
        drawHeader(); // Optionnel : remettre le header ou juste le titre
        cursorY = 55;
      }

      // Titre Catégorie
      doc.setFontSize(16);
      doc.setTextColor(26, 86, 219);
      doc.setFont('helvetica', 'bold');
      doc.text(`CATÉGORIE : ${category.category.toUpperCase()}`, 14, cursorY);

      cursorY += 8;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont('helvetica', 'normal');
      doc.text(`${category.participants.length} participants • Séries de ${category.seriesSize}`, 14, cursorY);

      cursorY += 10;

      category.rounds.forEach(round => {
        // Vérification espace pour le titre du round
        if (cursorY > pageHeight - 30) {
          doc.addPage();
          cursorY = 20;
        }

        doc.setFillColor(240, 240, 240);
        doc.rect(14, cursorY - 5, pageWidth - 28, 8, 'F');

        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        doc.text(`ROUND ${round.round}`, 18, cursorY);
        cursorY += 10;

        round.heats.forEach(heat => {
          // Vérification espace pour le heat + un peu du tableau
          if (cursorY > pageHeight - 40) {
            doc.addPage();
            cursorY = 20;
          }

          doc.setFontSize(10);
          doc.setTextColor(50);
          doc.setFont('helvetica', 'bold');
          doc.text(
            `Heat ${heat.heat_number} (${heat.surfers.length} surfeurs)`,
            14,
            cursorY
          );
          cursorY += 2;

          autoTable(doc, {
            startY: cursorY,
            head: [['Couleur', 'Nom', 'Pays']],
            body: heat.surfers.map(surfer => [
              surfer.color,
              surfer.name,
              surfer.country
            ]),
            theme: 'grid',
            headStyles: {
              fillColor: [55, 65, 81],
              textColor: 255,
              fontSize: 9,
              fontStyle: 'bold'
            },
            bodyStyles: {
              fontSize: 9,
              textColor: 50
            },
            alternateRowStyles: {
              fillColor: [249, 250, 251]
            },
            columnStyles: {
              0: { cellWidth: 30, fontStyle: 'bold' },
              1: { cellWidth: 'auto' },
              2: { cellWidth: 40 }
            },
            margin: { left: 14, right: 14 },
            didParseCell: function (data) {
              // Coloration du texte de la couleur (optionnel)
              if (data.section === 'body' && data.column.index === 0) {
                const colorMap: Record<string, [number, number, number]> = {
                  'ROUGE': [220, 38, 38],
                  'BLANC': [100, 100, 100], // Gris foncé pour lisibilité
                  'JAUNE': [202, 138, 4],
                  'BLEU': [37, 99, 235],
                  'VERT': [22, 163, 74],
                  'NOIR': [0, 0, 0]
                };
                const colorName = (data.cell.raw as string).toUpperCase();
                if (colorMap[colorName]) {
                  data.cell.styles.textColor = colorMap[colorName];
                }
              }
            }
          });

          const lastY = (doc as any).lastAutoTable?.finalY ?? cursorY;
          cursorY = lastY + 10;
        });
        cursorY += 5;
      });
      cursorY += 10;
    });

    // --- PIED DE PAGE (Footer) ---
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175); // Gris clair
      const footerText = `Généré par KIOSK Surf Judging le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')} - Page ${i}/${pageCount}`;
      doc.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' });
    }

    const filename = `Heats_${(eventName || 'Event').replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
  };

  const handleExportCSV = () => {
    if (previewData.length === 0) return;

    const headers = ['Catégorie', 'Round', 'Heat', 'Couleur', 'Nom', 'Pays'];
    const rows = previewData.flatMap(category =>
      category.rounds.flatMap(round =>
        round.heats.flatMap(heat =>
          heat.surfers.map(surfer => [
            category.category,
            round.round,
            heat.heat_number,
            surfer.color,
            surfer.name,
            surfer.country
          ])
        )
      )
    );

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `heats_${eventId || 'competition'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-6">
          <EventStatus />
        </div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Générer les séries</h1>
          <p className="text-gray-400">
            Choisissez la catégorie et le format pour créer la structure des rounds.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-xl font-semibold mb-6">Format</h2>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <button
                  onClick={() => setSelectedFormat('elimination')}
                  className={`p-4 rounded-lg border ${selectedFormat === 'elimination'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-700'
                    }`}
                >
                  Élimination directe
                </button>
                <button
                  onClick={() => setSelectedFormat('repechage')}
                  className={`p-4 rounded-lg border ${selectedFormat === 'repechage'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-700'
                    }`}
                >
                  Repêchage
                </button>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Taille de série préférée
                  </label>
                  <select
                    value={seriesSize}
                    onChange={e => setSeriesSize(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2"
                  >
                    <option value="auto">Auto</option>
                    <option value="2">Man on Man</option>
                    <option value="3">3 surfeurs</option>
                    <option value="4">4 surfeurs</option>
                    <option value="5">5 surfeurs</option>
                    <option value="6">6 surfeurs</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Format du Round 2
                  </label>
                  <select
                    value={roundFormat}
                    onChange={e => setRoundFormat(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2"
                  >
                    <option value="heats-3">Heats de 3 (Finale à 4)</option>
                    <option value="man-on-man">Man-on-Man (2 surfeurs)</option>
                  </select>
                </div>
              </div>
            </div>

            {previewData.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-semibold">Prévisualisation des heats</h2>
                  <div className="flex gap-4">
                    <button
                      onClick={handleExportPDF}
                      className="px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-500"
                    >
                      Exporter PDF
                    </button>
                    <button
                      onClick={handleExportCSV}
                      className="px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-500"
                    >
                      Exporter CSV
                    </button>
                  </div>
                </div>

                <div className="space-y-10">
                  {previewData.map(category => (
                    <div key={category.category} className="space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-2xl font-semibold text-blue-400">
                          Catégorie {category.category}
                        </h3>
                        <div className="text-sm text-gray-400">
                          {category.participants.length} participants • Séries de{' '}
                          {category.seriesSize}
                        </div>
                      </div>
                      {category.rounds.map(round => (
                        <div key={round.round} className="space-y-4">
                          <h4 className="text-lg font-medium text-gray-300">ROUND {round.round}</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {round.heats.map((heat, index) => (
                              <div key={index} className="bg-gray-900 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <h5 className="text-blue-400 font-semibold">
                                    HEAT {heat.heat_number}
                                  </h5>
                                  <span className="text-sm text-gray-500">
                                    {heat.surfers.length} surfeur{heat.surfers.length > 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {heat.surfers.map((surfer, idx) => (
                                    <div
                                      key={idx}
                                      className={`p-3 rounded-lg grid grid-cols-[auto,1fr] gap-3 items-center ${surfer.color === 'ROUGE'
                                        ? 'bg-red-600'
                                        : surfer.color === 'BLANC'
                                          ? 'bg-gray-200 text-gray-900'
                                          : surfer.color === 'JAUNE'
                                            ? 'bg-yellow-500 text-gray-900'
                                            : surfer.color === 'BLEU'
                                              ? 'bg-blue-600'
                                              : surfer.color === 'VERT'
                                                ? 'bg-green-600'
                                                : surfer.color === 'NOIR'
                                                  ? 'bg-gray-800'
                                                  : 'bg-gray-700'
                                        }`}
                                    >
                                      <div className="w-3 h-3 rounded-full bg-white" />
                                      <div>
                                        <div className="font-medium">{surfer.name}</div>
                                        <div className="text-sm opacity-75">{surfer.country}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-1 space-y-4">
            <button
              onClick={handlePreview}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
            >
              Générer la prévisualisation
            </button>

            {participants.length === 0 && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded">
                <div className="font-medium">Aucun participant trouvé</div>
                <div className="text-sm mt-1">
                  Importez ou ajoutez des participants depuis la page{' '}
                  <button onClick={() => navigate('/participants')} className="underline">
                    Participants
                  </button>{' '}
                  pour générer des séries correctes (la catégorie sera inférée).
                </div>
              </div>
            )}

            {previewData.length > 0 && (
              <button
                onClick={handleConfirm}
                className="w-full bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium"
              >
                Confirmer et écrire dans la base
              </button>
            )}

            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  {participants.length} participant{participants.length > 1 ? 's' : ''}
                </div>
                <div>
                  {totalHeats} heat{totalHeats > 1 ? 's' : ''}
                </div>
                <div>Dernière mise à jour : {new Date().toLocaleTimeString()}</div>
              </div>
              {previewData.length > 0 && (
                <div className="mt-3 space-y-1 text-sm text-gray-400">
                  {previewData.map(category => (
                    <div key={category.category}>
                      {category.category}:{' '}
                      {category.rounds.reduce((acc, round) => acc + round.heats.length, 0)} heats •{' '}
                      {category.participants.length} surfeurs
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerateHeatsPage;
