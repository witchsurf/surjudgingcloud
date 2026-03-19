import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createHeatsWithEntries } from '../api/supabaseClient';
import {
  generatePreviewHeats,
  getManOnManRoundOptions,
  type ManOnManRoundOption
} from '../utils/heatGeneration';
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
  const { setActiveEventId, setConfig, setConfigSaved, saveConfigToDb } = useConfigStore();
  const [selectedFormat, setSelectedFormat] = useState<'elimination' | 'repechage'>('elimination');
  const [categoryManOnManRounds, setCategoryManOnManRounds] = useState<Record<string, number>>({});
  const [categoryBestSecondWildcards, setCategoryBestSecondWildcards] = useState<Record<string, boolean>>({});
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
      return 4;
    }
    return Math.max(1, parseInt(seriesSize, 10) || 2);
  };

  const groupedParticipants = useMemo(
    () => participants.reduce<Record<string, ParticipantRecord[]>>((acc, participant) => {
      const rawCategory =
        (participant.category ||
          (participant as ParticipantRecord).division ||
          'OPEN') as string;
      const category = rawCategory?.trim() || 'OPEN';
      if (!acc[category]) acc[category] = [];
      acc[category].push(participant as ParticipantRecord);
      return acc;
    }, {}),
    [participants]
  );

  const categoryManOnManOptions = useMemo(
    () => Object.entries(groupedParticipants).reduce<Record<string, ManOnManRoundOption[]>>((acc, [category, list]) => {
      const baseSeriesSize = getSeriesSize();
      const computedSeriesSize = Math.max(
        1,
        Math.min(baseSeriesSize, list.length || baseSeriesSize)
      );

      acc[category] = getManOnManRoundOptions(list, selectedFormat, computedSeriesSize);
      return acc;
    }, {}),
    [groupedParticipants, selectedFormat, seriesSize]
  );

  useEffect(() => {
    if (!eventId || participants.length === 0) return;

    try {
      const preview = Object.entries(groupedParticipants)
        .map(([category, list]) => {
          const baseSeriesSize = getSeriesSize();
          const computedSeriesSize = Math.max(
            1,
            Math.min(baseSeriesSize, list.length || baseSeriesSize)
          );

          const allowedRounds = categoryManOnManOptions[category] || [];
          const requestedRound = categoryManOnManRounds[category] || 0;
          const selectedRound = allowedRounds.some((option) => option.round === requestedRound)
            ? requestedRound
            : 0;
          const selectedOption = allowedRounds.find((option) => option.round === selectedRound);
          const enableBestSecond = Boolean(
            selectedOption?.requiresBestSecond && categoryBestSecondWildcards[category]
          );

          const rounds = generatePreviewHeats(
            list,
            selectedFormat,
            computedSeriesSize,
            selectedRound > 0
              ? {
                manOnManFromRound: selectedRound,
                promoteBestSecond: enableBestSecond
              }
              : undefined
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
    } catch (error) {
      console.error('Erreur lors de la génération des heats:', error);
    }
  }, [
    categoryBestSecondWildcards,
    categoryManOnManOptions,
    categoryManOnManRounds,
    eventId,
    groupedParticipants,
    participants.length,
    selectedFormat,
    seriesSize
  ]);

  const handlePreview = () => {
    // This button is now largely redundant for normal flow but can be kept as a manual refresh
    if (!eventId) {
      alert('Aucun événement sélectionné. Veuillez créer ou sélectionner un événement.');
      navigate('/my-events');
      return;
    }
    // Logic is now in useEffect
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

      const numericId = parseInt(currentEventId || '', 10);
      if (!numericId || isNaN(numericId) || numericId <= 0) {
        throw new Error(`ID d'événement invalide (${currentEventId}). Veuillez recharger la page.`);
      }

      for (const categoryPreview of previewData) {
        // Build participants map for the API
        const participantsBySeed = new Map<number, any>();
        categoryPreview.participants.forEach((p: any) => {
          if (typeof p.seed === 'number') {
            participantsBySeed.set(p.seed, p);
          }
        });

        await createHeatsWithEntries(
          numericId,
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
          categoryManOnManRounds,
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
      if (numericId && !isNaN(numericId)) {
        setActiveEventId(numericId);
        setConfig(configPayload);
        setConfigSaved(true);
        // Sync to cloud so Display page/Judges see the names immediately
        await saveConfigToDb(numericId, configPayload);
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

  const handleExportPDF = async () => {
    if (previewData.length === 0) return;

    // --- DATA RETRIEVAL ---
    const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
    const eventName = eventData.name || 'Compétition de Surf';
    const organizer = eventData.organizer || 'Fédération de Surf';
    const startDate = eventData.start_date ? new Date(eventData.start_date).toLocaleDateString('fr-FR') : '';
    const endDate = eventData.end_date ? new Date(eventData.end_date).toLocaleDateString('fr-FR') : '';
    const dateRange = startDate ? (endDate && startDate !== endDate ? `${startDate} au ${endDate}` : startDate) : 'Date non définie';

    // Logo Retrieval (supporting multiple candidate fields)
    let logoBase64: string | null = null;
    const logoCandidate = (
      eventData.organizerLogoDataUrl ||
      eventData.image_url ||
      eventData.brand_logo_url ||
      eventData?.config?.organizerLogoDataUrl
    ) as string | undefined;

    if (logoCandidate) {
      if (logoCandidate.startsWith('data:image/')) {
        logoBase64 = logoCandidate;
      } else if (/^https?:\/\//i.test(logoCandidate)) {
        try {
          const resp = await fetch(logoCandidate);
          const blob = await resp.blob();
          logoBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn('Could not load logo for PDF:', e);
        }
      }
    }

    // --- PDF INITIALIZATION ---
    // @ts-ignore
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm' });
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 14;
    const contentWidth = pageWidth - (margin * 2);

    // --- STYLING CONSTANTS ---
    const COLORS = {
      primary: [15, 23, 42],   // Slate-900
      accent: [220, 38, 38],   // Red-600
      gold: [251, 191, 36],    // Gold-500
      text: [51, 65, 85],      // Slate-700
      muted: [148, 163, 184],  // Slate-400
      border: [226, 232, 240]  // Slate-200
    };

    // --- HEADER RENDERER ---
    const drawHeader = (isFirstPage: boolean) => {
      if (isFirstPage) {
        // Background Bar
        doc.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
        doc.rect(0, 0, pageWidth, 40, 'F');

        // Logo
        let textStartX = margin;
        if (logoBase64) {
          try {
            const format = logoBase64.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
            doc.addImage(logoBase64, format, margin, 8, 24, 24);
            textStartX = margin + 30;
          } catch (e) {
            console.warn('Failed to add logo to PDF:', e);
          }
        }

        // Event Titles
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(eventName.toUpperCase(), textStartX, 18);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(200, 200, 200);
        doc.text('PLAN OFFICIEL DES SÉRIES', textStartX, 24);

        // Organizer & Date Info (Right aligned)
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        const organizerText = `Organisé par : ${organizer}`;
        const dateText = `Dates : ${dateRange}`;
        doc.text(organizerText, pageWidth - margin, 18, { align: 'right' });
        doc.text(dateText, pageWidth - margin, 24, { align: 'right' });

        return 48; // cursorY after header
      } else {
        // Minimal header for subsequent pages
        doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
        doc.setLineWidth(0.2);
        doc.line(margin, 15, pageWidth - margin, 15);

        doc.setFontSize(8);
        doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
        doc.text(`${eventName.toUpperCase()} — PLAN DES SÉRIES`, margin, 12);
        return 22;
      }
    };

    let cursorY = drawHeader(true);

    // --- CONTENT RENDERING ---
    previewData.forEach((category, catIdx) => {
      // Category Title Block
      if (cursorY > pageHeight - 50) {
        doc.addPage();
        cursorY = drawHeader(false);
      }

      // Decorative category separator
      if (catIdx > 0) {
        cursorY += 5;
        doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
        doc.line(margin, cursorY, pageWidth - margin, cursorY);
        cursorY += 8;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
      doc.text(`CATÉGORIE : ${category.category.toUpperCase()}`, margin, cursorY);

      cursorY += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      doc.text(`${category.participants.length} participants • Séries de ${category.seriesSize}`, margin, cursorY);
      cursorY += 8;

      category.rounds.forEach((round) => {
        // Round Heading
        if (cursorY > pageHeight - 40) {
          doc.addPage();
          cursorY = drawHeader(false);
        }

        doc.setFillColor(248, 250, 252); // Slate-50
        doc.rect(margin, cursorY - 4, contentWidth, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
        doc.text(`ROUND ${round.round}`, margin + 2, cursorY + 1);
        cursorY += 8;

        round.heats.forEach((heat) => {
          // Heat Check
          if (cursorY > pageHeight - 35) {
            doc.addPage();
            cursorY = drawHeader(false);
          }

          doc.setFontSize(9);
          doc.setTextColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2]);
          doc.text(`Heat ${heat.heat_number}`, margin, cursorY);
          cursorY += 2;

          autoTable(doc, {
            startY: cursorY,
            head: [['#', 'Lycra', 'Nom du Surfeur', 'Pays / Club']],
            body: heat.surfers.map((s, i) => [i + 1, s.color, s.name, s.country]),
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 1.5, font: 'helvetica' },
            headStyles: {
              fillColor: COLORS.primary as any,
              textColor: 255,
              fontStyle: 'bold'
            },
            columnStyles: {
              0: { cellWidth: 8 },
              1: { cellWidth: 20, fontStyle: 'bold' },
              2: { cellWidth: 'auto' },
              3: { cellWidth: 35 }
            },
            margin: { left: margin, right: margin },
            didParseCell: (data) => {
              if (data.section === 'body' && data.column.index === 1) {
                const colorMap: Record<string, { bg: [number, number, number], text: [number, number, number] }> = {
                  'ROUGE': { bg: [220, 38, 38], text: [255, 255, 255] },
                  'BLANC': { bg: [255, 255, 255], text: [15, 23, 42] },
                  'JAUNE': { bg: [251, 191, 36], text: [15, 23, 42] },
                  'BLEU': { bg: [37, 99, 235], text: [255, 255, 255] },
                  'VERT': { bg: [22, 163, 74], text: [255, 255, 255] },
                  'NOIR': { bg: [15, 23, 42], text: [255, 255, 255] }
                };
                const val = (data.cell.raw as string).toUpperCase();
                if (colorMap[val]) {
                  data.cell.styles.fillColor = colorMap[val].bg;
                  data.cell.styles.textColor = colorMap[val].text;
                }
              }
            }
          });

          cursorY = (doc as any).lastAutoTable.finalY + 6;
        });
        cursorY += 4;
      });
      cursorY += 6;
    });

    // --- FOOTER ---
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(COLORS.muted[0], COLORS.muted[1], COLORS.muted[2]);
      const footerText = `Généré par KIOSK Surf Judging le ${new Date().toLocaleDateString('fr-FR')} — Page ${i} sur ${pageCount}`;
      doc.text(footerText, pageWidth / 2, pageHeight - 8, { align: 'center' });
    }

    const filename = `Heats_Plan_${(eventName || 'Event').replace(/[^a-z0-9]/gi, '_')}.pdf`;
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
                    Information
                  </label>
                  <div className="text-gray-400 text-sm italic py-2">
                    Le Man-on-Man est maintenant configurable par catégorie dans la prévisualisation ci-dessous.
                  </div>
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
                  {previewData.map(category => {
                    const manOnManOptions = categoryManOnManOptions[category.category] || [];
                    const requestedRound = categoryManOnManRounds[category.category] || 0;
                    const selectedManOnManRound = manOnManOptions.some((option) => option.round === requestedRound)
                      ? requestedRound
                      : 0;
                    const selectedManOnManOption = manOnManOptions.find(
                      (option) => option.round === selectedManOnManRound
                    );
                    const bestSecondEnabled = Boolean(
                      selectedManOnManOption?.requiresBestSecond &&
                      categoryBestSecondWildcards[category.category]
                    );

                    return (
                    <div key={category.category} className="space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-gray-700/30 p-4 rounded-lg">
                        <div className="mb-4 sm:mb-0">
                          <h3 className="text-2xl font-semibold text-blue-400">
                            Catégorie {category.category}
                          </h3>
                          <div className="text-sm text-gray-400">
                            {category.participants.length} participants • Séries de{' '}
                            {category.seriesSize}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-sm font-medium text-gray-300">
                            Man-on-Man à partir du :
                          </label>
                          <select
                            value={selectedManOnManRound}
                            onChange={e => {
                              const newVal = parseInt(e.target.value, 10);
                              setCategoryManOnManRounds(prev => ({
                                ...prev,
                                [category.category]: newVal
                              }));
                              if (newVal === 0) {
                                setCategoryBestSecondWildcards(prev => ({
                                  ...prev,
                                  [category.category]: false
                                }));
                              }
                            }}
                            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm"
                          >
                            <option value="0">Désactivé</option>
                            {manOnManOptions.map((option) => (
                              <option key={option.round} value={option.round}>
                                {option.requiresBestSecond
                                  ? `Round ${option.round} (meilleur 2e requis)`
                                  : `Round ${option.round}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {selectedManOnManOption?.requiresBestSecond && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-50">
                          <div className="font-semibold text-amber-200">
                            Attention: ce passage en Man-on-Man crée un bracket impair.
                          </div>
                          <p className="mt-2 text-amber-100">
                            {selectedManOnManOption.warning}
                          </p>
                          <label className="mt-4 flex items-start gap-3 text-amber-50">
                            <input
                              type="checkbox"
                              checked={bestSecondEnabled}
                              onChange={(event) => {
                                setCategoryBestSecondWildcards(prev => ({
                                  ...prev,
                                  [category.category]: event.target.checked
                                }));
                              }}
                              className="mt-1 h-4 w-4 rounded border-amber-300 bg-gray-900 text-amber-500"
                            />
                            <span>
                              Ajouter le meilleur 2e du Round {selectedManOnManOption.wildcardSourceRound}
                              {' '}pour compléter le tableau en man-on-man.
                            </span>
                          </label>
                          <p className="mt-2 text-xs text-amber-200/80">
                            Un placeholder `Meilleur 2e R{selectedManOnManOption.wildcardSourceRound}` sera ajouté
                            dans la prévisualisation et dans le bracket généré.
                          </p>
                        </div>
                      )}
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
                    );
                  })}
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
