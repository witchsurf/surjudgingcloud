import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoundSpec } from './bracket';
import type { AppConfig, Score } from '../types';
import { colorLabelMap } from './colorUtils';
import { calculateSurferStats } from './scoring';

interface HeatResultHistoryEntry {
  heatKey: string;
  round: number;
  heatNumber: number;
  rank: number;
  color: string;
  total: number;
  name: string;
  country?: string | null;
}

type HeatResultHistory = Record<string, HeatResultHistoryEntry[]>;

const colorLabelSet = new Set(Object.values(colorLabelMap));

interface ExportHeatResultsPayload {
  eventName: string;
  category: string;
  config: AppConfig;
  rounds: RoundSpec[];
  history: HeatResultHistory;
  currentHeatKey: string;
}

interface FullCompetitionExportPayload {
  eventName: string;
  organizer?: string;
  date?: string;
  divisions: Record<string, RoundSpec[]>;
  scores: Record<string, Score[]>;
}

const slugify = (value: string) =>
(value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'bracket');

const buildHeatTable = (round: RoundSpec, heatIndex: number) => {
  const heat = round.heats[heatIndex];
  const body = heat.slots.map((slot, idx) => [
    idx + 1,
    slot.color ? colorLabelMap[slot.color] : `COULOIR ${idx + 1}`,
    slot.result != null ? slot.result.toFixed(2) : '',
    slot.name ?? slot.placeholder ?? '',
    slot.country ?? '',
  ]);
  return { heat, body };
};

const applyResultsToRounds = (
  rounds: RoundSpec[],
  mapping: Map<string, { name: string; country?: string }>
): RoundSpec[] => {
  return rounds.map((round) => ({
    ...round,
    heats: round.heats.map((heat) => ({
      ...heat,
      slots: heat.slots.map((slot) => {
        if (slot.placeholder) {
          // Try multiple placeholder formats:
          // 1. "QUALIFIÉ R1-H1 (P1)" or "Repêchage R1-H1 (P3)" or "Finaliste R5-H1 (P1)"
          // 2. "R1-H1-P1" (legacy format)

          const placeholder = slot.placeholder.toUpperCase();

          // Extract round, heat, position from formats like "QUALIFIÉ R1-H1 (P1)"
          const match = placeholder.match(/R(\d+)-H(\d+)\s*\(P(\d+)\)/);
          if (match) {
            const [, round, heat, pos] = match;
            const key = `R${round}-H${heat}-P${pos}`;
            const info = mapping.get(key);
            if (info) {
              return {
                ...slot,
                placeholder: undefined,
                name: info.name,
                country: info.country,
                result: null,
              };
            }
          }

          // Try direct match (legacy format "R1-H1-P1")
          const info = mapping.get(placeholder);
          if (info) {
            return {
              ...slot,
              placeholder: undefined,
              name: info.name,
              country: info.country,
              result: null,
            };
          }
        }
        return { ...slot };
      }),
    })),
  }));
};

export function exportBracketToPDF(eventName: string, category: string, rounds: RoundSpec[], repechage?: RoundSpec[], surferNames?: Record<string, string>, eventDetails?: { organizer?: string; date?: string }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const renderRound = (round: RoundSpec) => {
    // Each round starts on a dedicated page with a centered header.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`${eventName.toUpperCase()} – ${category.toUpperCase()}`, width / 2, 60, { align: 'center' });

    // Add organizer and date if provided
    let headerY = 90;
    if (eventDetails?.organizer || eventDetails?.date) {
      doc.setFontSize(10);
      const subHeader = [eventDetails.organizer, eventDetails.date].filter(Boolean).join(' • ');
      doc.text(subHeader, width / 2, 78, { align: 'center' });
      headerY = 95;
    }

    doc.setFontSize(14);
    doc.text(round.name.toUpperCase(), width / 2, headerY, { align: 'center' });

    let startY = headerY + 25;
    round.heats.forEach((_, idx) => {
      const { heat, body } = buildHeatTable(round, idx);
      // Replace missing athlete names with surferNames lookup
      const enrichedBody = body.map(row => {
        const [pos, color, result, athlete, country] = row;
        if (!athlete && surferNames) {
          const nameFromMap = surferNames[color] ?? '';
          return [pos, color, result, nameFromMap, country];
        }
        return row;
      });
      doc.setFontSize(12);
      doc.text(`HEAT ${heat.heatNumber}`, width / 2, startY, { align: 'center' });
      autoTable(doc, {
        head: [['Pos', 'Couleur', 'Résultat', 'Athlète / Placeholder', 'Pays / Club']],
        body: enrichedBody,
        startY: startY + 10,
        styles: { font: 'helvetica', fontSize: 10, halign: 'center', valign: 'middle' },
        headStyles: { fillColor: [12, 148, 236], textColor: 255, fontStyle: 'bold' },
        tableLineWidth: 0.4,
        tableLineColor: [30, 41, 59],
      });
      const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
      startY = (lastTable?.finalY ?? startY) + 24;
      if (idx < round.heats.length - 1 && startY > doc.internal.pageSize.getHeight() - 120) {
        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(`${eventName.toUpperCase()} – ${category.toUpperCase()}`, width / 2, 60, { align: 'center' });
        doc.setFontSize(14);
        doc.text(round.name.toUpperCase(), width / 2, 90, { align: 'center' });
        startY = 120;
      }
    });
  };

  const allRounds = [...rounds, ...(repechage ?? [])];
  allRounds.forEach((round, idx) => {
    if (idx > 0) doc.addPage();
    renderRound(round);
  });

  doc.save(`${slugify(`${eventName}-${category}`)}_bracket.pdf`);
}

export function exportBracketToCSV(eventName: string, category: string, rounds: RoundSpec[], repechage?: RoundSpec[]): string {
  const lines: string[] = [];
  lines.push('event,category,round,heat,color,athlete,country,seed,placeholder');

  const dumpRound = (round: RoundSpec) => {
    round.heats.forEach((heat) => {
      heat.slots.forEach((slot, idx) => {
        const color = slot.color ? colorLabelMap[slot.color] : `Couloir ${idx + 1}`;
        lines.push(
          [
            JSON.stringify(eventName),
            JSON.stringify(category),
            JSON.stringify(round.name),
            heat.heatNumber,
            JSON.stringify(color),
            JSON.stringify(slot.name ?? ''),
            JSON.stringify(slot.country ?? ''),
            slot.seed ?? '',
            JSON.stringify(slot.placeholder ?? ''),
          ].join(','),
        );
      });
    });
  };

  rounds.forEach(dumpRound);
  (repechage ?? []).forEach(dumpRound);

  return lines.join('\n');
}

const normalizeHistoryWithRounds = (
  history: HeatResultHistory,
  rounds: RoundSpec[],
  currentHeatKey: string
) => {
  const byHeat = new Map<string, Map<string, { name: string; country?: string }>>();

  rounds.forEach((round) => {
    round.heats.forEach((heat) => {
      if (!heat.heatId) return;
      const colorMap = byHeat.get(heat.heatId) ?? new Map<string, { name: string; country?: string }>();
      heat.slots.forEach((slot) => {
        if (!slot.color || !slot.name) return;
        const label = colorLabelMap[slot.color]?.toUpperCase();
        if (!label) return;
        colorMap.set(label, { name: slot.name, country: slot.country });
      });
      byHeat.set(heat.heatId, colorMap);
    });
  });

  Object.entries(history).forEach(([heatKey, entries]) => {
    entries.forEach((entry) => {
      const heatMap = byHeat.get(heatKey);
      if (heatMap) {
        const info = heatMap.get(entry.color.toUpperCase());
        if (info) {
          const currentName = entry.name?.toUpperCase() ?? '';
          if (!entry.name || colorLabelSet.has(currentName)) {
            entry.name = info.name;
          }
          if (!entry.country && info.country) {
            entry.country = info.country;
          }
        }
      }
      if (heatKey !== currentHeatKey) {
        entry.heatKey = heatKey;
      }
    });
  });
};

const buildPlaceholderMapFromHistory = (history: HeatResultHistory) => {
  const map = new Map<string, { name: string; country?: string }>();
  Object.values(history).forEach((entries) => {
    entries.forEach((entry) => {
      const key = `R${entry.round}-H${entry.heatNumber}-P${entry.rank}`.toUpperCase();
      map.set(key, { name: entry.name, country: entry.country ?? undefined });
    });
  });
  return map;
};

const buildHeatResultLookup = (history: HeatResultHistory) => {
  const lookup = new Map<string, Map<string, number>>();
  Object.entries(history).forEach(([heatKey, entries]) => {
    const perColor = new Map<string, number>();
    entries.forEach((entry) => {
      perColor.set(entry.color.toUpperCase(), entry.total);
    });
    lookup.set(heatKey, perColor);
  });
  return lookup;
};

export function exportHeatResultsPDF({ eventName, category, config, rounds, history, currentHeatKey }: ExportHeatResultsPayload) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('STRUCTURE DES HEATS', width / 2, 60, { align: 'center' });

  if (rounds.length) {
    normalizeHistoryWithRounds(history, rounds, currentHeatKey);
    const placeholderMap = buildPlaceholderMapFromHistory(history);
    const heatResultLookup = buildHeatResultLookup(history);

    const updatedRounds = applyResultsToRounds(rounds, placeholderMap).map((round) => ({
      ...round,
      heats: round.heats.map((heat) => {
        const heatResults = heatResultLookup.get(heat.heatId ?? '');
        if (!heatResults) {
          return {
            ...heat,
            slots: heat.slots.map((slot) => ({ ...slot, result: null })),
          };
        }

        const slots = heat.slots.map((slot) => {
          if (!slot.color) return { ...slot, result: null };
          const label = colorLabelMap[slot.color]?.toUpperCase();
          if (!label) return { ...slot, result: null };
          const value = heatResults.get(label);
          return { ...slot, result: value ?? null };
        });

        return {
          ...heat,
          slots,
        };
      }),
    }));

    let startY = 90;
    updatedRounds.forEach((round, roundIdx) => {
      const title = `${round.name.toUpperCase()} (R${round.roundNumber})`;
      doc.setFontSize(12);
      doc.text(title, width / 2, startY, { align: 'center' });
      startY += 10;

      round.heats.forEach((_, heatIdx) => {
        const { body } = buildHeatTable(round, heatIdx);
        autoTable(doc, {
          startY,
          head: [['Pos', 'Couleur', 'Résultat', 'Athlète / Placeholder', 'Pays']],
          body,
          styles: { font: 'helvetica', fontSize: 9, halign: 'center', valign: 'middle' },
          headStyles: { fillColor: [12, 148, 236], textColor: 255, fontStyle: 'bold' },
          tableLineWidth: 0.4,
          tableLineColor: [30, 41, 59],
        });
        const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
        startY = (lastTable?.finalY ?? startY) + 16;

        if (startY > doc.internal.pageSize.getHeight() - 80 && (roundIdx !== updatedRounds.length - 1 || heatIdx !== round.heats.length - 1)) {
          doc.addPage();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.text('STRUCTURE DES HEATS (SUITE)', width / 2, 60, { align: 'center' });
          startY = 90;
        }
      });
    });
  }

  doc.save(`${slugify(`${eventName}-${category}-heat${config.heatId}`)}_structure.pdf`);
}

export function exportHeatScorecardPdf({
  config,
  scores,
  surferNames,
  surferCountries,
}: {
  config: AppConfig;
  scores: Score[];
  surferNames?: Record<string, string>;
  surferCountries?: Record<string, string>;
}) {
  if (!config?.competition) {
    throw new Error('Configuration de heat invalide pour export PDF');
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const namesMap = surferNames ?? config.surferNames ?? {};
  const countriesMap = surferCountries ?? config.surferCountries ?? {};

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`${config.competition} – ${config.division || 'Division ?'}`, width / 2, 50, { align: 'center' });
  doc.setFontSize(12);
  doc.text(`Round ${config.round} · Heat ${config.heatId}`, width / 2, 70, { align: 'center' });

  const stats = calculateSurferStats(scores, config.surfers, config.judges.length, config.waves);

  if (!stats.length) {
    doc.setFontSize(14);
    doc.text('Aucune note enregistrée pour ce heat.', width / 2, doc.internal.pageSize.getHeight() / 2, { align: 'center' });
    doc.save(`${slugify(`${config.competition}-${config.division}-R${config.round}H${config.heatId}`)}_scores.pdf`);
    return;
  }

  const ordered = [...stats].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const maxWaves = Math.max(
    ...ordered.map((stat) => stat.waves.length),
    config.waves,
    1
  );
  const limitedWaves = Math.min(maxWaves, 6);

  const head: string[] = ['Rang', 'Lycra', 'Nom', 'Pays'];
  for (let i = 0; i < limitedWaves; i += 1) {
    head.push(`V${i + 1}`);
  }
  head.push('Best 2');

  const body = ordered.map((stat) => {
    const row: (string | number)[] = [];
    const displayName = namesMap[stat.surfer] ?? stat.surfer;
    const country = countriesMap[stat.surfer] ?? '';
    row.push(stat.rank ?? '-');
    row.push(stat.surfer);
    row.push(displayName);
    row.push(country);

    for (let i = 0; i < limitedWaves; i += 1) {
      const wave = stat.waves.find((w) => w.wave === i + 1);
      row.push(wave && wave.score > 0 ? wave.score.toFixed(2) : '');
    }

    row.push((stat.bestTwo ?? 0).toFixed(2));
    return row;
  });

  autoTable(doc, {
    startY: 100,
    head: [head],
    body,
    styles: { font: 'helvetica', fontSize: 10, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: [12, 74, 110], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'left' },
      3: { halign: 'left' },
    },
  });

  doc.save(`${slugify(`${config.competition}-${config.division}-R${config.round}H${config.heatId}`)}_scores.pdf`);
}

/**
 * Export complete competition PDF with all categories, all heats, results, and qualifiers
 */
export function exportFullCompetitionPDF({
  eventName,
  organizer,
  date,
  divisions,
  scores,
}: FullCompetitionExportPayload) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  // === BUILD QUALIFIER MAPPINGS FROM SCORES ===
  // Map: "DIVISION ROUND HEAT (POSITION)" → {name, country}
  const qualifierMap = new Map<string, { name: string; country?: string }>();

  Object.entries(divisions).forEach(([divisionName, rounds]) => {
    rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        if (!heat.heatId || !scores[heat.heatId]) return;

        const heatScores = scores[heat.heatId];
        if (heatScores.length === 0) return;

        // Group scores by surfer/color
        const surferResults: Array<{
          color: string;
          name: string;
          country?: string;
          best2: number;
        }> = [];

        heat.slots.forEach((slot) => {
          if (!slot.name || !slot.color) return; // Skip placeholders and slots without color

          const colorMatch = colorLabelMap[slot.color as keyof typeof colorLabelMap];
          const surferScores = heatScores.filter(
            (s) => s.surfer === colorMatch || s.surfer === slot.color
          );

          // Calculate best 2 waves
          const waveAverages: Record<number, number[]> = {};
          surferScores.forEach((s) => {
            if (!waveAverages[s.wave_number]) waveAverages[s.wave_number] = [];
            const val = Number(s.score);
            if (!isNaN(val)) waveAverages[s.wave_number].push(val);
          });

          const waveScores = Object.values(waveAverages).map((scores) => {
            if (scores.length === 0) return 0;
            return scores.reduce((sum, s) => sum + s, 0) / scores.length;
          });

          waveScores.sort((a, b) => b - a);
          const best2 = waveScores.slice(0, 2).reduce((sum, s) => sum + s, 0);

          surferResults.push({
            color: slot.color,
            name: slot.name,
            country: slot.country,
            best2,
          });
        });

        // Sort by best2 descending
        surferResults.sort((a, b) => b.best2 - a.best2);

        // Create mappings for top 4 (or however many qualified)
        surferResults.forEach((result, index) => {
          const position = index + 1;

          // Generate multiple key formats to match different placeholder styles
          const keys = [
            // Format 1: "OPEN R1 H1 (P1)"
            `${divisionName.toUpperCase()} R${round.roundNumber} H${heat.heatNumber} (P${position})`,
            // Format 2: "QUALIFIÉ R1-H1 (P1)" (generic)
            `QUALIFIÉ R${round.roundNumber}-H${heat.heatNumber} (P${position})`,
            // Format 3: "R1-H1-P1" (legacy)
            `R${round.roundNumber}-H${heat.heatNumber}-P${position}`,
          ];

          keys.forEach(key => {
            qualifierMap.set(key, {
              name: result.name,
              country: result.country,
            });
          });
        });
      });
    });
  });

  // === RESOLVE PLACEHOLDERS IN ALL ROUNDS ===
  Object.values(divisions).forEach((rounds) => {
    rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.slots.forEach((slot) => {
          if (slot.placeholder && !slot.bye) {
            const normalized = slot.placeholder.toUpperCase().trim();
            const qualified = qualifierMap.get(normalized);
            if (qualified) {
              // Replace placeholder with actual participant
              slot.name = qualified.name;
              if (qualified.country) slot.country = qualified.country;
              delete slot.placeholder;
              delete slot.bye;
            }
          }
        });
      });
    });
  });

  // === PAGE DE GARDE ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text(eventName.toUpperCase(), width / 2, height / 3, { align: 'center' });

  if (organizer) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text(`Organisé par ${organizer}`, width / 2, height / 3 + 40, { align: 'center' });
  }

  if (date) {
    doc.setFontSize(12);
    doc.text(date, width / 2, height / 3 + 65, { align: 'center' });
  }

  // Liste des catégories sur la page de garde
  const categoryNames = Object.keys(divisions);
  if (categoryNames.length) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('CATÉGORIES', width / 2, height / 2, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    categoryNames.forEach((cat, idx) => {
      doc.text(`• ${cat}`, width / 2, height / 2 + 25 + idx * 18, { align: 'center' });
    });
  }

  // Date d'export
  doc.setFontSize(10);
  doc.setTextColor(128);
  doc.text(`Exporté le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, width / 2, height - 40, { align: 'center' });
  doc.setTextColor(0);

  // === POUR CHAQUE CATÉGORIE ===
  Object.entries(divisions).forEach(([categoryName, allRounds]) => {
    if (!allRounds.length) return;

    // Detect and Shift Repechage Rounds
    const mainRounds: typeof allRounds = [];
    const repRounds: typeof allRounds = [];

    // Heuristic: If a round only has "REPÊCHAGE" sources, it's a rep round.
    allRounds.forEach((r) => {
      // Check first heat slots for clues
      const hasRep = r.heats.some((h) =>
        h.slots.some((s) => {
          if (!s.placeholder) return false;
          const txt = s.placeholder.toUpperCase();
          // Match "REPÊCHAGE", explicit ranks (P3)/(3), or suffixes like -3, -P3
          return txt.includes('REPÊCHAGE') ||
            txt.includes('(P3)') || txt.includes('(P4)') ||
            txt.includes('(3)') || txt.includes('(4)') ||
            /[- ]P?[34]$/.test(txt);
        })
      );
      if (hasRep) {
        repRounds.push(r);
      } else {
        mainRounds.push(r);
      }
    });

    const renderRoundGroup = (groupName: string, roundsToRender: typeof allRounds, isRepechage: boolean) => {
      if (roundsToRender.length === 0) return;

      // Page de titre de section (Main vs Repechage)
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(24);
      doc.text(`${categoryName.toUpperCase()} - ${groupName}`, width / 2, 60, { align: 'center' });

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      const totalHeats = roundsToRender.reduce((acc, r) => acc + r.heats.length, 0);
      doc.text(`${roundsToRender.length} rounds • ${totalHeats} heats`, width / 2, 85, { align: 'center' });

      let startY = 120;

      roundsToRender.forEach((round, idx) => {
        // Custom Round Name for Repechage
        let displayRoundName = round.name.toUpperCase();
        if (isRepechage) {
          // Rename "Round 3" -> "REPÊCHAGE ROUND 1"
          displayRoundName = `REPÊCHAGE ROUND ${idx + 1} (${round.name})`;
        }

        // Titre du round
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(isRepechage ? 220 : 12, isRepechage ? 38 : 148, isRepechage ? 38 : 236); // Redish for Rep, Blue for Main
        doc.text(displayRoundName, 40, startY);
        doc.setTextColor(0);
        startY += 20;

        round.heats.forEach((heat, heatIdx) => {
          const heatScores = heat.heatId ? scores[heat.heatId] ?? [] : [];
          const hasResults = heatScores.length > 0;

          // Use the same calculation logic as Display
          let surferStats: Array<{ surfer: string; bestTwo: number; rank: number }> = [];
          if (hasResults) {
            const heatSurfers = heat.slots
              .filter(s => s.color !== undefined)
              .map(s => colorLabelMap[s.color as keyof typeof colorLabelMap] || s.color!);

            // Get judge count from scores (count unique judge_ids)
            const uniqueJudges = new Set(heatScores.map(s => s.judge_id));
            const judgeCount = uniqueJudges.size;

            const stats = calculateSurferStats(
              heatScores,
              heatSurfers,
              judgeCount,
              20, // maxWaves
              true // allowIncomplete = true for finished heats
            );

            surferStats = stats.map(s => ({
              surfer: s.surfer,
              bestTwo: s.bestTwo,
              rank: s.rank
            }));
          }

          const body = heat.slots.map((slot, sIdx) => {
            let result = '';
            let numericScore = 0;

            if (hasResults && slot.color) {
              const colorMatch = colorLabelMap[slot.color as keyof typeof colorLabelMap] || slot.color;
              const stat = surferStats.find(s => s.surfer === colorMatch);

              if (stat) {
                numericScore = stat.bestTwo;
                result = stat.bestTwo.toFixed(2);
              }
            }

            return {
              position: sIdx + 1,
              lycra: slot.color ? colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color : `COULOIR ${sIdx + 1}`,
              score: result || (slot.result != null ? slot.result.toFixed(2) : ''),
              numericScore,
              surfer: slot.name ?? slot.placeholder ?? '',
              country: slot.country ?? '',
            };
          });

          if (hasResults) body.sort((a, b) => b.numericScore - a.numericScore);

          const tableBody = body.map((row, rIdx) => [
            rIdx + 1,
            row.lycra,
            row.score,
            row.surfer,
            row.country,
          ]);

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.text(`Heat ${heat.heatNumber}`, 50, startY);
          if (hasResults) {
            doc.setFontSize(9);
            doc.setTextColor(34, 197, 94);
            doc.text('✓ Résultats', 120, startY);
            doc.setTextColor(0);
          }
          startY += 8;

          autoTable(doc, {
            startY,
            head: [['#', 'Lycra', 'Score', 'Surfeur', 'Pays']],
            body: tableBody,
            styles: { font: 'helvetica', fontSize: 9, halign: 'center', valign: 'middle', cellPadding: 3 },
            headStyles: { fillColor: hasResults ? [34, 197, 94] : (isRepechage ? [220, 38, 38] : [12, 148, 236]), textColor: 255, fontStyle: 'bold' },
            columnStyles: { 3: { halign: 'left' }, 4: { halign: 'left' } },
            tableLineWidth: 0.3,
            tableLineColor: [200, 200, 200],
            margin: { left: 50, right: 50 },
          });

          const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
          startY = (lastTable?.finalY ?? startY) + 20;

          if (startY > height - 100 && (heatIdx !== round.heats.length - 1)) {
            doc.addPage();
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.text(`${categoryName} - ${groupName} (suite)`, width / 2, 40, { align: 'center' });
            startY = 70;
          }
        });
        startY += 10;

        // Page break between rounds if getting full
        if (startY > height - 150 && idx !== roundsToRender.length - 1) {
          doc.addPage();
          startY = 70;
        }
      });
    };

    // Render Main Brackets
    renderRoundGroup("TABLEAU PRINCIPAL", mainRounds, false);

    // Render Repechage Brackets
    if (repRounds.length > 0) {
      renderRoundGroup("TABLEAU DE REPÊCHAGE", repRounds, true);
    }

  });
  doc.save(`${slugify(eventName)}_competition_complete.pdf`);
}

