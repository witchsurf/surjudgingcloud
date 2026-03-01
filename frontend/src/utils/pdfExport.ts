import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoundSpec } from './bracket';
import type { AppConfig, InterferenceCall, Score } from '../types';
import { colorLabelMap } from './colorUtils';
import { calculateSurferStats } from './scoring';
import { computeEffectiveInterferences } from './interference';

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
  interferenceCalls?: Record<string, InterferenceCall[]>;
  configuredJudgeCount?: number;
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
          // 1. "R1-H1-P1" (current format, matches supabaseClient regex)
          // 2. "QUALIFIÉ R1-H1 (P1)" or "Repêchage R1-H1 (P3)" (display format with prefix)
          // 3. "R1-H1 (P1)" (old format with parentheses)

          const placeholder = slot.placeholder.toUpperCase();

          // Format 1: Direct match "R1-H1-P1" or "RP1-H1-P1"
          let info = mapping.get(placeholder);
          if (info) {
            return {
              ...slot,
              placeholder: undefined,
              name: info.name,
              country: info.country,
              result: null,
            };
          }

          // Format 2: Extract from "QUALIFIÉ R1-H1 (P1)" or "R1-H1 (P1)"
          const match = placeholder.match(/R(P?)(\d+)-H(\d+)\s*\(P(\d+)\)/);
          if (match) {
            const [, prefix, round, heat, pos] = match;
            const key = `R${prefix}${round}-H${heat}-P${pos}`;
            info = mapping.get(key);
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
    doc.save(`${slugify(`${eventName}-${category}-heat${config.heatId}`)}_structure.pdf`);
  }
}

// Palette de couleurs pour le PDF
const PDF_COLORS: Record<string, [number, number, number] | string> = {
  'ROUGE': [239, 68, 68],
  'BLANC': [248, 250, 252], // Fond gris clair pour être visible
  'JAUNE': [234, 179, 8],
  'BLEU': [59, 130, 246],
  'VERT': [34, 197, 94],
  'NOIR': [31, 41, 55]
};

const normalizeLycraForPdf = (value: string) => {
  const key = value.trim().toUpperCase();
  if (key === 'RED') return 'ROUGE';
  if (key === 'WHITE') return 'BLANC';
  if (key === 'YELLOW') return 'JAUNE';
  if (key === 'BLUE') return 'BLEU';
  if (key === 'GREEN') return 'VERT';
  if (key === 'BLACK') return 'NOIR';
  return key;
};

const SEED_ORDER = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'];
const getSeedPriority = (color: string) => {
  const idx = SEED_ORDER.indexOf(color.toUpperCase());
  return idx === -1 ? 99 : idx;
};

export function exportHeatScorecardPdf({
  config,
  scores,
  surferNames,
  surferCountries,
  eventData,
}: {
  config: AppConfig;
  scores: Score[];
  surferNames?: Record<string, string>;
  surferCountries?: Record<string, string>;
  eventData?: any;
}) {
  if (!config?.competition) {
    throw new Error('Configuration de heat invalide pour export PDF');
  }

  // Create landscape document for better width availability
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const namesMap = surferNames ?? config.surferNames ?? {};
  const countriesMap = surferCountries ?? config.surferCountries ?? {};

  // --- HEADER PRO ---
  // Background gradient-like header
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, width, 100, 'F');

  // Event Name
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  const title = eventData?.name?.toUpperCase() ?? config.competition.toUpperCase();
  doc.text(title, width / 2, 40, { align: 'center' });

  // Organizer / Subtitle
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184); // slate-400
  const organizer = eventData?.organizer ? `Organisé par ${eventData.organizer}` : '';
  const dateStr = eventData?.start_date ? ` • ${new Date(eventData.start_date).toLocaleDateString('fr-FR')}` : '';
  doc.text(`${organizer}${dateStr}`, width / 2, 60, { align: 'center' });

  // Heat Info Badge
  doc.setFillColor(30, 41, 59); // slate-800
  doc.roundedRect(width / 2 - 150, 75, 300, 30, 15, 15, 'F');
  doc.setTextColor(56, 189, 248); // sky-400
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`${config.division} • R${config.round} • HEAT ${config.heatId}`, width / 2, 94, { align: 'center' });

  // --- CONTENT ---
  const stats = calculateSurferStats(scores, config.surfers, config.judges.length, config.waves);

  if (!stats.length) {
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.text('Aucune note enregistrée pour ce heat.', width / 2, 200, { align: 'center' });
    doc.save(`${slugify(`${config.competition}-${config.division}-R${config.round}H${config.heatId}`)}_scores.pdf`);
    return;
  }

  // TRI : Par Rang puis par Seeding (Couleur)
  const ordered = [...stats].sort((a, b) => {
    const rankDiff = (a.rank ?? 99) - (b.rank ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return getSeedPriority(a.surfer) - getSeedPriority(b.surfer);
  });

  // VAGUES DYNAMIQUES : Max de vagues surfées
  const maxTaken = Math.max(...stats.map(s => s.waves.filter(w => w.score > 0).length), 0);
  // On affiche au moins config.waves ou ce qui a été surfé, borné par 1 et le max possible
  const columnsToShow = Math.max(1, Math.min(config.waves, Math.max(maxTaken, 5)));
  // J'utilise Math.max(maxTaken, 5) pour montrer au moins 5 colonnes vides si rien n'est surfé, pour garder la forme du tableau

  const displayWavesKey = Array.from({ length: columnsToShow }, (_, i) => i + 1);

  const head: string[] = ['#', 'Lycra', 'Surfeur', 'Pays'];
  displayWavesKey.forEach(w => head.push(`V${w}`));
  head.push('Best 2');

  const body = ordered.map((stat) => {
    const row: (string | number)[] = [];
    const displayName = namesMap[stat.surfer] ?? stat.surfer;
    const country = countriesMap[stat.surfer] ?? '';
    row.push(stat.rank ?? '-');
    row.push(colorLabelMap[stat.surfer as keyof typeof colorLabelMap] ?? stat.surfer); // Traduction couleur si possible
    row.push(displayName);
    row.push(country);

    displayWavesKey.forEach(wIdx => {
      const wave = stat.waves.find((w) => w.wave === wIdx);
      row.push(wave && wave.score > 0 ? wave.score.toFixed(2) : '-');
    });

    row.push((stat.bestTwo ?? 0).toFixed(2));
    return row;
  });

  autoTable(doc, {
    startY: 130,
    head: [head],
    body,
    styles: {
      font: 'helvetica',
      fontSize: 9, // Slightly smaller font
      halign: 'center',
      valign: 'middle',
      cellPadding: 4
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
      fontStyle: 'bold',
      lineWidth: 0
    },
    columnStyles: {
      0: { cellWidth: 30 }, // Rank
      1: { cellWidth: 50, fontSize: 8, fontStyle: 'bold' }, // Lycra
      2: { halign: 'left', fontStyle: 'bold', cellWidth: 120 }, // Nom surfeur (larges for full names)
      3: { halign: 'left', fontSize: 8, cellWidth: 60 }, // Pays
      // Wave columns will autosize
      // Best 2 column bold
      [head.length - 1]: { fontStyle: 'bold', fillColor: [240, 253, 244], cellWidth: 50, textColor: [22, 101, 52] }
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    tableLineColor: [203, 213, 225],
    tableLineWidth: 0.1,
    margin: { left: 20, right: 20 }, // Use full width

    // COLORATION LYCRA
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const surferColorName = ordered[data.row.index].surfer; // Récupère la couleur brute (ROUGE)
        const rgb = PDF_COLORS[surferColorName];
        if (rgb) {
          if (Array.isArray(rgb)) {
            data.cell.styles.fillColor = rgb;
            // Texte blanc sauf pour Jaune et Blanc
            if (surferColorName === 'JAUNE' || surferColorName === 'BLANC') {
              data.cell.styles.textColor = [0, 0, 0];
            } else {
              data.cell.styles.textColor = [255, 255, 255];
            }
          }
        }
      }
    }
  });

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, width / 2, pageHeight - 15, { align: 'center' });

  doc.save(`${slugify(`${config.competition}-${config.division}-R${config.round}H${config.heatId}`)}_scores.pdf`);
}

/**
 * Export complete competition PDF with all categories
 */
export function exportFullCompetitionPDF({
  eventName,
  organizer,
  date,
  divisions,
  scores,
  interferenceCalls = {},
  configuredJudgeCount,
}: FullCompetitionExportPayload) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  const normalizeDivisionName = (value: string) =>
    value
      .toUpperCase()
      .trim()
      .replace(/[_\s]+/g, ' ')
      .replace(/\s+/g, ' ');

  const mergedDivisions = Object.entries(divisions).reduce<Record<string, RoundSpec[]>>((acc, [rawName, rounds]) => {
    const key = normalizeDivisionName(rawName);
    const existing = acc[key] ?? [];
    const byRound = new Map<number, RoundSpec>();

    [...existing, ...rounds].forEach((round) => {
      const roundKey = Number(round.roundNumber);
      const current = byRound.get(roundKey);
      if (!current) {
        byRound.set(roundKey, {
          ...round,
          name: round.name,
          heats: [...round.heats],
        });
        return;
      }

      const knownHeatIds = new Set(current.heats.map((h) => (h.heatId || '').toLowerCase()));
      round.heats.forEach((heat) => {
        const normalizedHeatId = (heat.heatId || '').toLowerCase();
        const alreadyPresent = normalizedHeatId
          ? knownHeatIds.has(normalizedHeatId)
          : current.heats.some((h) => h.heatNumber === heat.heatNumber);
        if (!alreadyPresent) {
          current.heats.push(heat);
          if (normalizedHeatId) knownHeatIds.add(normalizedHeatId);
        }
      });

      current.heats.sort((a, b) => a.heatNumber - b.heatNumber);
    });

    acc[key] = Array.from(byRound.values()).sort((a, b) => a.roundNumber - b.roundNumber);
    return acc;
  }, {});

  const normalizePlaceholderKey = (value: string) =>
    value
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\(\)\[\]]/g, ' ')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeHeatKey = (value?: string | null) => (value || '').toLowerCase().trim();
  const normalizedScoresByHeat: Record<string, Score[]> = {};
  Object.entries(scores).forEach(([heatKey, heatScores]) => {
    normalizedScoresByHeat[normalizeHeatKey(heatKey)] = heatScores;
  });
  const normalizedInterferencesByHeat: Record<string, InterferenceCall[]> = {};
  Object.entries(interferenceCalls).forEach(([heatKey, heatCalls]) => {
    normalizedInterferencesByHeat[normalizeHeatKey(heatKey)] = heatCalls;
  });

  const getHeatScoringParams = (heatScores: Score[]) => {
    const judgeCount = new Set(heatScores.map((s) => s.judge_id).filter(Boolean)).size;
    const maxWaves = Math.max(
      1,
      ...heatScores.map((s) => Number(s.wave_number) || 0)
    );
    return {
      judgeCount: Math.max(configuredJudgeCount || 0, judgeCount, 1),
      maxWaves,
    };
  };

  const buildQualifierKeyVariants = (
    divisionName: string,
    roundNumber: number,
    heatNumber: number,
    position: number
  ) => ([
    `${divisionName} R${roundNumber} H${heatNumber} (P${position})`,
    `QUALIFIE R${roundNumber}-H${heatNumber} (P${position})`,
    `QUALIFIE R${roundNumber}-H${heatNumber} P${position}`,
    `QUALIFIE R${roundNumber} H${heatNumber} P${position}`,
    `FINALISTE R${roundNumber}-H${heatNumber} (P${position})`,
    `FINALISTE R${roundNumber}-H${heatNumber} P${position}`,
    `FINALISTE R${roundNumber} H${heatNumber} P${position}`,
    `R${roundNumber}-H${heatNumber}-P${position}`,
    `R${roundNumber} H${heatNumber} P${position}`,
  ]);

  const qualifierMapByDivision = new Map<string, Map<string, { name: string; country?: string }>>();
  const implicitQualifierCursor = new Map<string, number>();
  const getDivisionQualifierMap = (divisionName: string) => {
    const key = divisionName.toUpperCase().trim();
    const existing = qualifierMapByDivision.get(key);
    if (existing) return existing;
    const created = new Map<string, { name: string; country?: string }>();
    qualifierMapByDivision.set(key, created);
    return created;
  };
  const isPlaceholderLike = (value?: string | null) => {
    if (!value) return false;
    const normalized = normalizePlaceholderKey(value);
    return normalized.includes('QUALIFI') ||
      normalized.includes('FINALISTE') ||
      normalized.includes('REPECH') ||
      /^R\s*\d+/.test(normalized) ||
      /^RP\s*\d+/.test(normalized) ||
      normalized.startsWith('POSITION') ||
      normalized === 'BYE';
  };

  const resolveQualifiedFromText = (divisionName: string, placeholderText: string) => {
    const divisionMap = getDivisionQualifierMap(divisionName);
    const normalized = normalizePlaceholderKey(placeholderText);
    let qualified = divisionMap.get(normalized);

    if (!qualified) {
      const match = normalized.match(/R\s*(\d+)\s*H\s*(\d+)\s*(?:P\s*)?(\d+)/);
      if (match) {
        const [, roundTxt, heatTxt, posTxt] = match;
        const fallbackKeys = buildQualifierKeyVariants(
          divisionName.toUpperCase(),
          Number(roundTxt),
          Number(heatTxt),
          Number(posTxt)
        );
        qualified = fallbackKeys
          .map((key) => divisionMap.get(normalizePlaceholderKey(key)))
          .find(Boolean);
      }
    }

    // Support placeholders without explicit position, e.g. "QUALIFIE R1-H1".
    // In this case we consume qualifiers in order (P1, then P2, ...).
    if (!qualified) {
      const noPosMatch = normalized.match(/R\s*(\d+)\s*H\s*(\d+)/);
      if (noPosMatch) {
        const [, roundTxt, heatTxt] = noPosMatch;
        const roundNumber = Number(roundTxt);
        const heatNumber = Number(heatTxt);
        const cursorKey = `${divisionName.toUpperCase().trim()}::${roundNumber}::${heatNumber}`;
        const startPos = (implicitQualifierCursor.get(cursorKey) ?? 0) + 1;

        for (let pos = startPos; pos <= 8; pos += 1) {
          const fallbackKeys = buildQualifierKeyVariants(
            divisionName.toUpperCase(),
            roundNumber,
            heatNumber,
            pos
          );
          qualified = fallbackKeys
            .map((key) => divisionMap.get(normalizePlaceholderKey(key)))
            .find(Boolean);
          if (qualified) {
            implicitQualifierCursor.set(cursorKey, pos);
            break;
          }
        }
      }
    }

    return qualified;
  };

  const writeHeatQualifiers = (
    divisionName: string,
    roundNumber: number,
    heatNumber: number,
    heatId: string | null,
    slots: Array<{
      color?: string;
      name?: string;
      country?: string;
      placeholder?: string;
      bye?: boolean;
    }>,
    heatScores: Score[]
  ) => {
    if (!heatScores.length) return;
    const divisionMap = getDivisionQualifierMap(divisionName);

    const slotByColor = new Map<string, { name?: string; placeholder?: string; country?: string }>();
    const heatSurfers = slots
      .filter((slot) => slot.color)
      .map((slot) => {
        const normalizedColor = normalizeLycraForPdf(
          colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color!
        );
        slotByColor.set(normalizedColor.toUpperCase(), {
          name: slot.name,
          placeholder: slot.placeholder,
          country: slot.country ?? undefined,
        });
        return normalizedColor;
      });

    if (!heatSurfers.length) return;
    const { judgeCount, maxWaves } = getHeatScoringParams(heatScores);
    const normalizedHeatScores = heatScores.map((score) => ({
      ...score,
      surfer: normalizeLycraForPdf(score.surfer),
    }));
    const heatKey = normalizeHeatKey(heatId);
    const heatInterferences = heatKey
      ? (normalizedInterferencesByHeat[heatKey] ?? [])
      : [];
    const effectiveInterferences = computeEffectiveInterferences(
      heatInterferences,
      Math.max(judgeCount, 1)
    );
    const stats = calculateSurferStats(
      normalizedHeatScores,
      heatSurfers,
      judgeCount,
      maxWaves,
      false,
      effectiveInterferences
    );

    const orderedStats = [...stats].sort((a, b) => {
      const rankDiff = (a.rank ?? 99) - (b.rank ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return getSeedPriority(a.surfer) - getSeedPriority(b.surfer);
    });

    orderedStats.forEach((stat, index) => {
      const slotInfo = slotByColor.get(stat.surfer.toUpperCase());
      if (!slotInfo) return;

      const resolvedName = slotInfo.name || slotInfo.placeholder || stat.surfer;
      const resolvedCountry = slotInfo.country;
      const position = index + 1;
      const keys = buildQualifierKeyVariants(
        divisionName.toUpperCase(),
        roundNumber,
        heatNumber,
        position
      );
      keys.forEach((key) => {
        divisionMap.set(normalizePlaceholderKey(key), {
          name: resolvedName,
          country: resolvedCountry,
        });
      });
    });
  };

  // Iterative propagation by round:
  // 1) resolve placeholders from previous heats
  // 2) compute current heat ranking from scores
  // 3) write new qualifier keys for next rounds
  Object.entries(mergedDivisions).forEach(([divisionName, rounds]) => {
    const orderedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

    orderedRounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.slots.forEach((slot) => {
          const candidate = slot.placeholder || (isPlaceholderLike(slot.name) ? slot.name : undefined);
          if (!candidate || slot.bye) return;
          const qualified = resolveQualifiedFromText(divisionName, candidate);
          if (!qualified) return;

          slot.name = qualified.name;
          if (qualified.country) slot.country = qualified.country;
          delete slot.placeholder;
          delete slot.bye;
        });

        const heatScores = heat.heatId ? (normalizedScoresByHeat[normalizeHeatKey(heat.heatId)] ?? []) : [];
        writeHeatQualifiers(
          divisionName,
          round.roundNumber,
          heat.heatNumber,
          heat.heatId ?? null,
          heat.slots,
          heatScores
        );
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
  const categoryNames = Object.keys(mergedDivisions);
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
  Object.entries(mergedDivisions).forEach(([categoryName, allRounds]) => {
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
          const heatScores = heat.heatId ? normalizedScoresByHeat[normalizeHeatKey(heat.heatId)] ?? [] : [];
          const hasResults = heatScores.length > 0;

          // Use the same calculation logic as Display
          let surferStats: Array<{ surfer: string; bestTwo: number; rank: number }> = [];
          if (hasResults) {
            const heatSurfers = heat.slots
              .filter(s => s.color !== undefined)
              .map(s => normalizeLycraForPdf(colorLabelMap[s.color as keyof typeof colorLabelMap] || s.color!));

            const { judgeCount, maxWaves } = getHeatScoringParams(heatScores);
            const heatInterferences = heat.heatId
              ? (normalizedInterferencesByHeat[normalizeHeatKey(heat.heatId)] ?? [])
              : [];
            const effectiveInterferences = computeEffectiveInterferences(
              heatInterferences,
              judgeCount
            );

            const stats = calculateSurferStats(
              heatScores.map((score) => ({ ...score, surfer: normalizeLycraForPdf(score.surfer) })),
              heatSurfers,
              judgeCount,
              maxWaves,
              false,
              effectiveInterferences
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
            columnStyles: {
              3: { halign: 'left', fontStyle: 'bold' },
              4: { halign: 'left' }
            },
            tableLineWidth: 0.3,
            tableLineColor: [200, 200, 200],
            margin: { left: 50, right: 50 },
            didParseCell: (data) => {
              if (data.section === 'body' && data.column.index === 1) {
                const lycraLabel = typeof data.row.raw?.[1] === 'string' ? data.row.raw[1] : '';
                const normalized = normalizeLycraForPdf(lycraLabel);
                const rgb = PDF_COLORS[normalized];
                if (Array.isArray(rgb)) {
                  data.cell.styles.fillColor = rgb;
                  data.cell.styles.textColor = normalized === 'JAUNE' || normalized === 'BLANC'
                    ? [0, 0, 0]
                    : [255, 255, 255];
                  data.cell.styles.fontStyle = 'bold';
                }
              }
            },
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
