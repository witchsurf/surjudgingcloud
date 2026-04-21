import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RoundSpec } from './bracket';
import type { AppConfig, InterferenceCall, Score } from '../types';
import { getScoreJudgeStation } from '../api/modules/scoring.api';
import { colorLabelMap } from './colorUtils';
import { calculateSurferStats } from './scoring';
import { calculateFinalRankings } from './ranking';
import { computeEffectiveInterferences } from './interference';
import { inferImplicitMappingsForHeat } from './heatSlotMappingInference';
import type { ParticipantRecord } from '../api/modules/participants.api';
import type { HeatRow } from '../api/modules/heats.api';

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
  organizerLogoDataUrl?: string;
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
          const placeholder = slot.placeholder.toUpperCase();
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`${eventName.toUpperCase()} – ${category.toUpperCase()}`, width / 2, 60, { align: 'center' });

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
      const enrichedBody = body.map(row => {
        const [pos, color, result, athlete, country] = row;
        if (!athlete && surferNames) {
          const nameFromMap = surferNames[color as string] ?? '';
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

export async function exportHeatResultsPDF({ eventName, category, config, rounds, history, currentHeatKey }: ExportHeatResultsPayload) {
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

// ============================================================
//  DESIGN SYSTEM – PRO PALETTE
// ============================================================
const DS = {
  // Primary deep navy
  navy:     [10,  15,  41]  as [number,number,number],
  navyMid:  [22,  32,  74]  as [number,number,number],
  navyLight:[37,  56, 120]  as [number,number,number],
  // Accent
  violet:   [109,  40, 217] as [number,number,number],
  gold:     [245, 158,  11] as [number,number,number],
  // Category stripe
  teal:     [ 15, 118, 110] as [number,number,number],
  // Status
  greenDark:[ 20,  83,  45] as [number,number,number],
  greenFill:[209, 250, 229] as [number,number,number],
  redDark:  [153,  27,  27] as [number,number,number],
  redFill:  [255, 228, 230] as [number,number,number],
  // Neutral
  white:    [255, 255, 255] as [number,number,number],
  gray50:   [249, 250, 251] as [number,number,number],
  gray100:  [243, 244, 246] as [number,number,number],
  gray200:  [229, 231, 235] as [number,number,number],
  gray400:  [156, 163, 175] as [number,number,number],
  gray700:  [ 55,  65,  81] as [number,number,number],
  gray900:  [ 17,  24,  39] as [number,number,number],
};

// Lycra colour fills in PDF
const LYCRA_COLOURS: Record<string, { fill: [number,number,number]; text: [number,number,number]; border: [number,number,number] }> = {
  ROUGE: { fill: [220, 38, 38],  text: [255,255,255], border: [185, 28, 28] },
  BLANC: { fill: [248,250,252],  text: [30, 41, 59],  border: [203,213,225] },
  JAUNE: { fill: [234,179, 8],   text: [28, 25, 23],  border: [161,138, 0]  },
  BLEU:  { fill: [37, 99,235],   text: [255,255,255], border: [29, 78,216]  },
  VERT:  { fill: [22,163, 74],   text: [255,255,255], border: [15,118, 55]  },
  NOIR:  { fill: [15, 23, 42],   text: [255,255,255], border: [30, 41, 59]  },
};

const normalizeLycraForPdf = (value: string) => {
  const key = value.trim().toUpperCase();
  if (key === 'RED')    return 'ROUGE';
  if (key === 'WHITE')  return 'BLANC';
  if (key === 'YELLOW') return 'JAUNE';
  if (key === 'BLUE')   return 'BLEU';
  if (key === 'GREEN')  return 'VERT';
  if (key === 'BLACK')  return 'NOIR';
  return key;
};

const SEED_ORDER = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'];
const getSeedPriority = (color: string) => {
  const idx = SEED_ORDER.indexOf(color.toUpperCase());
  return idx === -1 ? 99 : idx;
};

// ============================================================
//  HEAT SCORECARD PDF (landscape, single heat)
// ============================================================
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

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const namesMap = surferNames ?? config.surferNames ?? {};
  const countriesMap = surferCountries ?? config.surferCountries ?? {};
  const logoCandidate = (
    eventData?.organizerLogoDataUrl ||
    eventData?.logo_url ||
    eventData?.logo ||
    eventData?.organizer_logo_url ||
    eventData?.image_url ||
    eventData?.brand_logo_url ||
    eventData?.config?.organizerLogoDataUrl
  ) as string | undefined;

  // ── HEADER BAND ──────────────────────────────────────────
  // Dark navy band full width
  doc.setFillColor(...DS.navy);
  doc.rect(0, 0, pageW, 88, 'F');

  // Violet left accent stripe
  doc.setFillColor(...DS.violet);
  doc.rect(0, 0, 6, 88, 'F');

  // Gold bottom rule
  doc.setFillColor(...DS.gold);
  doc.rect(0, 86, pageW, 2, 'F');

  if (logoCandidate && logoCandidate.startsWith('data:image/')) {
    try {
      const fmt = logoCandidate.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
      doc.addImage(logoCandidate, fmt, 20, 16, 48, 48);
    } catch (error) {
      console.warn('Heat scorecard logo error:', error);
    }
  }

  // Event name
  doc.setTextColor(...DS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  const title = (eventData?.name ?? config.competition).toUpperCase();
  doc.text(title, logoCandidate ? 78 : 24, 36);

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...DS.gray400);
  const organizer = eventData?.organizer ? `Organisé par ${eventData.organizer}` : '';
  const dateStr = eventData?.start_date ? new Date(eventData.start_date).toLocaleDateString('fr-FR', { year:'numeric', month:'long', day:'numeric' }) : '';
  const subtitle = [organizer, dateStr].filter(Boolean).join('  •  ');
  if (subtitle) doc.text(subtitle, 24, 52);

  // Heat badge (rounded rect on the right)
  const badgeText = `${config.division}  •  ROUND ${config.round}  •  HEAT ${config.heatId}`;
  const badgeW = doc.getTextWidth(badgeText) + 28;
  const badgeX = pageW - badgeW - 20;
  doc.setFillColor(...DS.navyMid);
  doc.roundedRect(badgeX, 20, badgeW, 26, 6, 6, 'F');
  doc.setFillColor(...DS.violet);
  doc.roundedRect(badgeX, 20, badgeW, 26, 6, 6, 'S');
  doc.setDrawColor(...DS.violet);
  doc.setLineWidth(1);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DS.white);
  doc.text(badgeText, badgeX + 14, 37);

  // Generated timestamp
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DS.gray400);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, pageW - 20, 72, { align: 'right' });

  // ── TABLE ─────────────────────────────────────────────────
  const stats = calculateSurferStats(scores, config.surfers, config.judges.length, config.waves, false, [], config.status);

  if (!stats.length) {
    doc.setTextColor(...DS.gray700);
    doc.setFontSize(13);
    doc.text('Aucune note enregistrée pour ce heat.', pageW / 2, 200, { align: 'center' });
    doc.save(`${slugify(`${config.competition}-${config.division}-R${config.round}H${config.heatId}`)}_scores.pdf`);
    return;
  }

  const ordered = [...stats].sort((a, b) => {
    const rankDiff = (a.rank ?? 99) - (b.rank ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return getSeedPriority(a.surfer) - getSeedPriority(b.surfer);
  });

  const maxTaken = Math.max(...stats.map(s => s.waves.filter(w => w.score > 0).length), 0);
  const columnsToShow = Math.max(1, Math.min(config.waves, Math.max(maxTaken, 5)));
  const waveKeys = Array.from({ length: columnsToShow }, (_, i) => i + 1);

  const head: string[] = ['#', 'LYCRA', 'SURFEUR', 'PAYS', ...waveKeys.map(w => `V${w}`), 'BEST 2'];

  const body = ordered.map((stat) => {
    const row: (string | number)[] = [];
    const displayName = namesMap[stat.surfer] ?? stat.surfer;
    const country = countriesMap[stat.surfer] ?? '';
    row.push(stat.rank ?? '-');
    row.push(normalizeLycraForPdf(colorLabelMap[stat.surfer as keyof typeof colorLabelMap] ?? stat.surfer));
    row.push(displayName);
    row.push(country);
    waveKeys.forEach(wIdx => {
      const wave = stat.waves.find((w) => w.wave === wIdx);
      row.push(wave && wave.score > 0 ? wave.score.toFixed(2) : '—');
    });
    row.push((stat.bestTwo ?? 0).toFixed(2));
    return row;
  });

  const scorecardUsableWidth = pageW - 40;
  const scorecardBaseWidths = {
    rank: 22,
    lycra: 52,
    surfer: 140,
    country: 56,
    bestTwo: 42,
  };
  const scorecardReservedWidth =
    scorecardBaseWidths.rank +
    scorecardBaseWidths.lycra +
    scorecardBaseWidths.surfer +
    scorecardBaseWidths.country +
    scorecardBaseWidths.bestTwo;
  const scorecardWaveWidth = clamp(
    (scorecardUsableWidth - scorecardReservedWidth) / Math.max(columnsToShow, 1),
    16,
    32
  );
  const scorecardSurferWidth = clamp(
    scorecardUsableWidth - (
      scorecardBaseWidths.rank +
      scorecardBaseWidths.lycra +
      scorecardBaseWidths.country +
      scorecardBaseWidths.bestTwo +
      scorecardWaveWidth * columnsToShow
    ),
    92,
    140
  );
  const scorecardCountryWidth = clamp(
    scorecardUsableWidth - (
      scorecardBaseWidths.rank +
      scorecardBaseWidths.lycra +
      scorecardSurferWidth +
      scorecardBaseWidths.bestTwo +
      scorecardWaveWidth * columnsToShow
    ),
    44,
    72
  );
  const scorecardWaveFontSize = scorecardWaveWidth <= 18 ? 6 : scorecardWaveWidth <= 22 ? 7 : 9;

  // Column styles
  const waveColStyle = { cellWidth: scorecardWaveWidth, halign: 'center' as const, fontSize: scorecardWaveFontSize };
  const colStyles: Record<number, any> = {
    0: { cellWidth: scorecardBaseWidths.rank, halign: 'center', fontStyle: 'bold', fontSize: 10 },
    1: { cellWidth: scorecardBaseWidths.lycra, halign: 'center', fontStyle: 'bold', fontSize: 8, overflow: 'hidden' },
    2: { cellWidth: scorecardSurferWidth, halign: 'left', fontStyle: 'bold', fontSize: 8, overflow: 'linebreak' },
    3: { cellWidth: scorecardCountryWidth, halign: 'left', fontSize: 7, overflow: 'hidden' },
    [head.length - 1]: { cellWidth: scorecardBaseWidths.bestTwo, halign: 'center', fontStyle: 'bold', fontSize: 10 },
  };
  for (let i = 0; i < columnsToShow; i++) {
    colStyles[4 + i] = waveColStyle;
  }

  autoTable(doc, {
    startY: 104,
    head: [head],
    body,
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 10,
      cellPadding: { top: 6, bottom: 6, left: 5, right: 5 },
      valign: 'middle',
      textColor: DS.gray900,
    },
    headStyles: {
      fillColor: DS.navy,
      textColor: DS.white,
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: { top: 5, bottom: 5, left: 5, right: 5 },
    },
    columnStyles: colStyles,
    alternateRowStyles: { fillColor: DS.gray50 },
    tableLineColor: DS.gray200,
    tableLineWidth: 0.3,
    margin: { left: 20, right: 20 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const label = normalizeLycraForPdf(String(data.cell.raw ?? ''));
        const lycra = LYCRA_COLOURS[label];
        if (lycra) {
          data.cell.styles.fillColor = lycra.fill;
          data.cell.styles.textColor = lycra.text;
        }
      }
      // Gold highlight for BEST 2 column
      if (data.section === 'body' && data.column.index === head.length - 1) {
        data.cell.styles.textColor = DS.greenDark;
        if (data.row.index === 0) {
          // First place: gold background
          data.cell.styles.fillColor = [254, 252, 232];
        }
      }
      // Rank column — colour rank 1 gold, 2 silver
      if (data.section === 'body' && data.column.index === 0) {
        if (data.row.index === 0) data.cell.styles.textColor = [180, 130, 0];
        else if (data.row.index === 1) data.cell.styles.textColor = [100, 116, 139];
      }
    },
  });

  // ── FOOTER ────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(...DS.gray400);
  doc.text('KIOSK Surf Judging System', 24, pageH - 12);
  doc.text(`Page 1 sur 1`, pageW - 24, pageH - 12, { align: 'right' });

  doc.save(`${slugify(`${config.competition}-${config.division}-R${config.round}H${config.heatId}`)}_scores.pdf`);
}

/**
 * Export complete competition PDF with all categories – PRO design
 */
export function exportFullCompetitionPDF({
  eventName,
  organizer,
  organizerLogoDataUrl,
  date,
  divisions,
  scores,
  interferenceCalls = {},
  configuredJudgeCount,
}: FullCompetitionExportPayload) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const MARGIN = 36;

  // ── helpers ────────────────────────────────────────────────
  const normalizeDivisionName = (value: string) =>
    value.toUpperCase().trim().replace(/[_\s]+/g, ' ').replace(/\s+/g, ' ');

  const mergedDivisions = Object.entries(divisions).reduce<Record<string, RoundSpec[]>>((acc, [rawName, rounds]) => {
    const key = normalizeDivisionName(rawName);
    const existing = acc[key] ?? [];
    const byRound = new Map<number, RoundSpec>();

    [...existing, ...rounds].forEach((round) => {
      const roundKey = Number(round.roundNumber);
      const current = byRound.get(roundKey);
      if (!current) {
        byRound.set(roundKey, { ...round, name: round.name, heats: [...round.heats] });
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
    value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[()[\]]/g, ' ').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();

  const normalizeHeatKey = (value?: string | null) => (value || '').toLowerCase().trim();
  const normalizeDivisionLookupKey = (value?: string | null) =>
    (value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_\s]+/g, ' ').trim();
  const parseHeatNumberFromId = (heatId?: string | null) => {
    const match = (heatId || '').match(/(?:^|_)h(\d+)$/i);
    return match ? Number(match[1]) : null;
  };
  const buildHeatMetaKey = (divisionName: string, roundNumber: number, heatNumber: number) =>
    `${normalizeDivisionLookupKey(divisionName)}::${Number(roundNumber)}::${Number(heatNumber)}`;

  const normalizedScoresByHeat: Record<string, Score[]> = {};
  const normalizedScoresByMeta: Record<string, Score[]> = {};
  Object.entries(scores).forEach(([heatKey, heatScores]) => {
    normalizedScoresByHeat[normalizeHeatKey(heatKey)] = heatScores;
    const sample = heatScores[0];
    const heatNumber = parseHeatNumberFromId(heatKey);
    if (!sample || heatNumber == null) return;
    const metaKey = buildHeatMetaKey(sample.division ?? '', sample.round ?? 0, heatNumber);
    if (!normalizedScoresByMeta[metaKey]) {
      normalizedScoresByMeta[metaKey] = heatScores;
    }
  });
  const normalizedInterferencesByHeat: Record<string, InterferenceCall[]> = {};
  const normalizedInterferencesByMeta: Record<string, InterferenceCall[]> = {};
  Object.entries(interferenceCalls).forEach(([heatKey, heatCalls]) => {
    normalizedInterferencesByHeat[normalizeHeatKey(heatKey)] = heatCalls;
    const sample = heatCalls[0];
    const heatNumber = parseHeatNumberFromId(heatKey);
    if (!sample || heatNumber == null) return;
    const metaKey = buildHeatMetaKey(sample.division ?? '', sample.round ?? 0, heatNumber);
    if (!normalizedInterferencesByMeta[metaKey]) {
      normalizedInterferencesByMeta[metaKey] = heatCalls;
    }
  });

  const resolveHeatScores = (divisionName: string, roundNumber: number, heatNumber: number, heatId?: string | null) => {
    const direct = heatId ? normalizedScoresByHeat[normalizeHeatKey(heatId)] ?? [] : [];
    if (direct.length > 0) return direct;
    return normalizedScoresByMeta[buildHeatMetaKey(divisionName, roundNumber, heatNumber)] ?? [];
  };

  const resolveHeatInterferences = (divisionName: string, roundNumber: number, heatNumber: number, heatId?: string | null) => {
    const direct = heatId ? normalizedInterferencesByHeat[normalizeHeatKey(heatId)] ?? [] : [];
    if (direct.length > 0) return direct;
    return normalizedInterferencesByMeta[buildHeatMetaKey(divisionName, roundNumber, heatNumber)] ?? [];
  };

  const getHeatScoringParams = (heatScores: Score[]) => {
    const judgeCount = new Set(heatScores.map((s) => getScoreJudgeStation(s)).filter(Boolean)).size;
    const maxWaves = Math.max(1, ...heatScores.map((s) => Number(s.wave_number) || 0));
    return { judgeCount: Math.max(configuredJudgeCount || 0, judgeCount, 1), maxWaves };
  };

  const buildQualifierKeyVariants = (divisionName: string, roundNumber: number, heatNumber: number, position: number) => ([
    `${divisionName} R${roundNumber} H${heatNumber} (P${position})`,
    `QUALIFIE R${roundNumber}-H${heatNumber} (P${position})`,
    `QUALIFIE R${roundNumber}-H${heatNumber} P${position}`,
    `QUALIFIE R${roundNumber} H${heatNumber} P${position}`,
    `FINALISTE R${roundNumber}-H${heatNumber} (P${position})`,
    `FINALISTE R${roundNumber}-H${heatNumber} P${position}`,
    `FINALISTE R${roundNumber} H${heatNumber} P${position}`,
    `VAINQUEUR R${roundNumber}-H${heatNumber} (P${position})`,
    `VAINQUEUR R${roundNumber}-H${heatNumber} P${position}`,
    `VAINQUEUR R${roundNumber} H${heatNumber} P${position}`,
    `WINNER R${roundNumber}-H${heatNumber} (P${position})`,
    `WINNER R${roundNumber}-H${heatNumber} P${position}`,
    `WINNER R${roundNumber} H${heatNumber} P${position}`,
    `R${roundNumber}-H${heatNumber}-P${position}`,
    `R${roundNumber} H${heatNumber} P${position}`,
  ]);

  const qualifierMapByDivision = new Map<string, Map<string, { name: string; country?: string }>>();
  const bestSecondByDivision = new Map<string, Map<number, { name: string; country?: string; score: number }>>();
  const implicitQualifierCursor = new Map<string, number>();
  const getDivisionQualifierMap = (divisionName: string) => {
    const key = divisionName.toUpperCase().trim();
    const existing = qualifierMapByDivision.get(key);
    if (existing) return existing;
    const created = new Map<string, { name: string; country?: string }>();
    qualifierMapByDivision.set(key, created);
    return created;
  };
  const getDivisionBestSecondMap = (divisionName: string) => {
    const key = divisionName.toUpperCase().trim();
    const existing = bestSecondByDivision.get(key);
    if (existing) return existing;
    const created = new Map<number, { name: string; country?: string; score: number }>();
    bestSecondByDivision.set(key, created);
    return created;
  };
  const parseBestSecondRound = (value?: string | null) => {
    if (!value) return null;
    const normalized = normalizePlaceholderKey(value);
    const match = normalized.match(/MEILLEUR\s*2E\s*R\s*(\d+)/);
    return match ? Number(match[1]) : null;
  };

  const isPlaceholderLike = (value?: string | null) => {
    if (!value) return false;
    const normalized = normalizePlaceholderKey(value);
    return normalized.includes('QUALIFI') || normalized.includes('FINALISTE') ||
      normalized.includes('REPECH') || normalized.includes('VAINQUEUR') ||
      normalized.includes('WINNER') || normalized.includes('MEILLEUR 2') ||
      /^R\s*\d+/.test(normalized) ||
      /^RP\s*\d+/.test(normalized) || normalized.startsWith('POSITION') || normalized === 'BYE';
  };

  const resolveQualifiedFromText = (divisionName: string, placeholderText: string) => {
    const divisionMap = getDivisionQualifierMap(divisionName);
    const bestSecondMap = getDivisionBestSecondMap(divisionName);
    const normalized = normalizePlaceholderKey(placeholderText);
    let qualified = divisionMap.get(normalized);

    if (!qualified) {
      const match = normalized.match(/R\s*(\d+)\s*H\s*(\d+)\s*(?:P\s*)?(\d+)/);
      if (match) {
        const [, roundTxt, heatTxt, posTxt] = match;
        const fallbackKeys = buildQualifierKeyVariants(divisionName.toUpperCase(), Number(roundTxt), Number(heatTxt), Number(posTxt));
        qualified = fallbackKeys.map((key) => divisionMap.get(normalizePlaceholderKey(key))).find(Boolean);
      }
    }

    if (!qualified) {
      const noPosMatch = normalized.match(/R\s*(\d+)\s*H\s*(\d+)/);
      if (noPosMatch) {
        const [, roundTxt, heatTxt] = noPosMatch;
        const roundNumber = Number(roundTxt);
        const heatNumber = Number(heatTxt);
        const cursorKey = `${divisionName.toUpperCase().trim()}::${roundNumber}::${heatNumber}`;
        const startPos = (implicitQualifierCursor.get(cursorKey) ?? 0) + 1;

        for (let pos = startPos; pos <= 8; pos += 1) {
          const fallbackKeys = buildQualifierKeyVariants(divisionName.toUpperCase(), roundNumber, heatNumber, pos);
          qualified = fallbackKeys.map((key) => divisionMap.get(normalizePlaceholderKey(key))).find(Boolean);
          if (qualified) { implicitQualifierCursor.set(cursorKey, pos); break; }
        }
      }
    }
    if (!qualified) {
      const bestSecondRound = parseBestSecondRound(placeholderText);
      if (bestSecondRound != null) {
        qualified = bestSecondMap.get(bestSecondRound);
      }
    }
    return qualified;
  };

  const writeHeatQualifiers = (
    divisionName: string, roundNumber: number, heatNumber: number,
    heatId: string | null,
    slots: Array<{ color?: string; name?: string; country?: string; placeholder?: string; bye?: boolean }>,
    heatScores: Score[],
    heatStatus?: string
  ) => {
    if (!heatScores.length) return;
    const divisionMap = getDivisionQualifierMap(divisionName);
    const bestSecondMap = getDivisionBestSecondMap(divisionName);
    const slotByColor = new Map<string, { name?: string; placeholder?: string; country?: string }>();

    const heatSurfers = slots.filter((slot) => slot.color).map((slot) => {
      const normalizedColor = normalizeLycraForPdf(colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color!);
      slotByColor.set(normalizedColor.toUpperCase(), { name: slot.name, placeholder: slot.placeholder, country: slot.country ?? undefined });
      return normalizedColor;
    });

    if (!heatSurfers.length) return;
    const { judgeCount, maxWaves } = getHeatScoringParams(heatScores);
    const normalizedHeatScores = heatScores.map((score) => ({ ...score, surfer: normalizeLycraForPdf(score.surfer) }));
    const heatInterferences = resolveHeatInterferences(divisionName, roundNumber, heatNumber, heatId);
    const effectiveInterferences = computeEffectiveInterferences(heatInterferences, Math.max(judgeCount, 1));
    const stats = calculateSurferStats(normalizedHeatScores, heatSurfers, judgeCount, maxWaves, false, effectiveInterferences, heatStatus);
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
      const keys = buildQualifierKeyVariants(divisionName.toUpperCase(), roundNumber, heatNumber, position);
      keys.forEach((key) => {
        divisionMap.set(normalizePlaceholderKey(key), { name: resolvedName, country: resolvedCountry });
      });
    });

    const bestSecond = orderedStats.find((stat) => stat.rank === 2);
    if (bestSecond) {
      const slotInfo = slotByColor.get(bestSecond.surfer.toUpperCase());
      if (slotInfo) {
        const resolvedName = slotInfo.name || slotInfo.placeholder || bestSecond.surfer;
        const currentBestSecond = bestSecondMap.get(roundNumber);
        if (!currentBestSecond || bestSecond.bestTwo > currentBestSecond.score) {
          bestSecondMap.set(roundNumber, {
            name: resolvedName,
            country: slotInfo.country,
            score: bestSecond.bestTwo,
          });
        }
      }
    }
  };

  // Propagate qualifiers across rounds
  Object.entries(mergedDivisions).forEach(([divisionName, rounds]) => {
    const orderedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

    const sequence = orderedRounds.flatMap((round) =>
      round.heats
        .filter((heat) => Boolean(heat.heatId))
        .map((heat) => ({
          id: heat.heatId as string,
          round: round.roundNumber,
          heat_number: heat.heatNumber,
          heat_size: heat.slots.length,
        }))
    );

    // Historical data can have empty future slots without explicit mappings.
    // Infer placeholder lineage from the bracket geometry so qualifier propagation
    // still resolves names in exported PDFs.
    orderedRounds.forEach((round) => {
      if (round.roundNumber <= 1) return;
      round.heats.forEach((heat) => {
        if (!heat.heatId) return;
        const inferred = inferImplicitMappingsForHeat(sequence, heat.heatId);
        inferred.forEach((mapping) => {
          const slot = heat.slots[mapping.position - 1];
          if (!slot || slot.name || slot.placeholder || slot.bye) return;
          slot.placeholder = mapping.placeholder;
        });
      });
    });

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
        const heatScores = resolveHeatScores(divisionName, round.roundNumber, heat.heatNumber, heat.heatId ?? null);
        writeHeatQualifiers(divisionName, round.roundNumber, heat.heatNumber, heat.heatId ?? null, heat.slots, heatScores, heat.status);
      });
    });
  });

  // ============================================================
  //  PAGE TEMPLATE: COVER PAGE
  // ============================================================
  // Full navy background
  doc.setFillColor(...DS.navy);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Violet vertical accent
  doc.setFillColor(...DS.violet);
  doc.rect(0, 0, 8, pageH, 'F');

  // Gold top band
  doc.setFillColor(...DS.gold);
  doc.rect(8, 0, pageW - 8, 6, 'F');

  // Logo image
  let logoEndY = 80;
  if (organizerLogoDataUrl) {
    try {
      const fmt = organizerLogoDataUrl.toLowerCase().includes('png') ? 'PNG' : 'JPEG';
      doc.addImage(organizerLogoDataUrl, fmt, MARGIN + 8, 60, 60, 60);
      logoEndY = 130;
    } catch (e) {
      console.warn('Logo error:', e);
    }
  }

  // Event name — large hero text
  doc.setTextColor(...DS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.text(eventName.toUpperCase(), MARGIN + 8, logoEndY + 40);

  // Divider line under event name
  doc.setDrawColor(...DS.violet);
  doc.setLineWidth(2);
  doc.line(MARGIN + 8, logoEndY + 50, pageW - MARGIN, logoEndY + 50);

  // Subtitle
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DS.gray400);
  const coverSubs: string[] = ['RAPPORT COMPLET DE LA COMPÉTITION'];
  if (organizer) coverSubs.push(`Organisé par  ${organizer}`);
  if (date) coverSubs.push(`Dates :  ${date}`);
  let coverSubY = logoEndY + 70;
  coverSubs.forEach(line => {
    doc.text(line, MARGIN + 8, coverSubY);
    coverSubY += 18;
  });

  // Division summary
  const divisionNames = Object.keys(mergedDivisions);
  if (divisionNames.length) {
    doc.setFontSize(9);
    doc.setTextColor(...DS.gray400);
    doc.text(`${divisionNames.length} CATÉGORIE${divisionNames.length > 1 ? 'S' : ''} :`, MARGIN + 8, coverSubY + 20);
    doc.setTextColor(...DS.white);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(divisionNames.join('  •  '), MARGIN + 8, coverSubY + 36);
  }

  // Footer of cover
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DS.gray400);
  doc.text(`Généré par KIOSK Surf Judging le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, pageW - MARGIN, pageH - 20, { align: 'right' });

  // ============================================================
  //  drawHeader for content pages (compact running header)
  // ============================================================
  const drawContentHeader = () => {
    // Slim navy band
    doc.setFillColor(...DS.navy);
    doc.rect(0, 0, pageW, 38, 'F');
    doc.setFillColor(...DS.violet);
    doc.rect(0, 0, 5, 38, 'F');
    doc.setFillColor(...DS.gold);
    doc.rect(5, 36, pageW - 5, 2, 'F');

    doc.setTextColor(...DS.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(eventName.toUpperCase(), MARGIN, 24);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...DS.gray400);
    doc.text('RAPPORT COMPLET', pageW - MARGIN, 24, { align: 'right' });

    return 52; // cursorY after header
  };

  // ============================================================
  //  CONTENT PAGES
  // ============================================================
  doc.addPage();
  let cursorY = drawContentHeader();

  const categories = Object.entries(mergedDivisions);

  categories.forEach(([categoryName, allRounds], catIdx) => {
    if (!allRounds.length) return;

    // Page break before new category (not the very first)
    if (catIdx > 0) {
      doc.addPage();
      cursorY = drawContentHeader();
    }

    // ── CATEGORY HEADER BLOCK ─────────────────────────────────
    // Full-width teal band
    doc.setFillColor(...DS.teal);
    doc.rect(0, cursorY, pageW, 32, 'F');
    doc.setTextColor(...DS.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(`CATÉGORIE : ${categoryName}`, MARGIN, cursorY + 21);

    cursorY += 42;

    const mainRounds: typeof allRounds = [];
    const repRounds: typeof allRounds = [];
    allRounds.forEach((r) => {
      const hasRep = r.heats.some((h) => h.slots.some((s) => {
        if (!s.placeholder) return false;
        const txt = s.placeholder.toUpperCase();
        return txt.includes('REPÊCHAGE') || txt.includes('(P3)') || txt.includes('(P4)') || /[- ]P?[34]$/.test(txt);
      }));
      if (hasRep) repRounds.push(r);
      else mainRounds.push(r);
    });

    const renderRounds = (roundsToRender: typeof allRounds, isRepechage: boolean) => {
      roundsToRender.forEach((round) => {
        if (cursorY > pageH - 80) {
          doc.addPage();
          cursorY = drawContentHeader();
        }

        const displayRoundName = isRepechage
          ? `REPÊCHAGE — ${round.name.toUpperCase()}`
          : round.name.toUpperCase();

        // Round title pill
        const pillColor = isRepechage ? DS.redDark : DS.navyLight;
        const pillText = isRepechage ? DS.redFill : DS.white;
        const pillW = doc.getTextWidth(displayRoundName) + 20;
        doc.setFillColor(...pillColor);
        doc.roundedRect(MARGIN, cursorY, pillW, 18, 3, 3, 'F');
        doc.setTextColor(...pillText);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(displayRoundName, MARGIN + 10, cursorY + 12);
        cursorY += 24;

        round.heats.forEach((heat) => {
          const heatScores = resolveHeatScores(categoryName, round.roundNumber, heat.heatNumber, heat.heatId ?? null);
          const hasResults = heatScores.length > 0;

          if (cursorY > pageH - 90) {
            doc.addPage();
            cursorY = drawContentHeader();
          }

          let surferStats: Array<{ surfer: string; bestTwo: number; rank: number; waves: number[] }> = [];
          let currentHeatMaxWaves = 0;

          if (hasResults) {
            const heatSurfers = heat.slots.filter(s => s.color !== undefined)
              .map(s => normalizeLycraForPdf(colorLabelMap[s.color as keyof typeof colorLabelMap] || s.color!));
            const { judgeCount, maxWaves } = getHeatScoringParams(heatScores);
            const heatInterferences = resolveHeatInterferences(categoryName, round.roundNumber, heat.heatNumber, heat.heatId ?? null);
            const effectiveInterferences = computeEffectiveInterferences(heatInterferences, judgeCount);
            const stats = calculateSurferStats(
              heatScores.map(score => ({ ...score, surfer: normalizeLycraForPdf(score.surfer) })),
              heatSurfers, judgeCount, maxWaves, false, effectiveInterferences, heat.status
            );
            const maxSurferWaves = Math.max(...stats.map(s => s.waves?.length || 0), 0);
            currentHeatMaxWaves = Math.max(1, Math.min(maxSurferWaves, maxWaves));
            surferStats = stats.map(s => ({
              surfer: s.surfer,
              bestTwo: s.bestTwo,
              rank: s.rank,
              waves: (s.waves || []).map(w => w.score)
            }));
          }

          const bodyData = heat.slots.map((slot, sIdx) => {
            let scoreStr = '';
            let numericVal = 0;
            let surferWaves: number[] = [];
            if (hasResults && slot.color) {
              const colorName = normalizeLycraForPdf(colorLabelMap[slot.color as keyof typeof colorLabelMap] || slot.color);
              const stat = surferStats.find(s => s.surfer === colorName);
              if (stat) { numericVal = stat.bestTwo; scoreStr = stat.bestTwo.toFixed(2); surferWaves = stat.waves; }
            }
            return {
              pos: sIdx + 1,
              lycra: slot.color ? normalizeLycraForPdf(colorLabelMap[slot.color as keyof typeof colorLabelMap] ?? slot.color) : `—`,
              score: scoreStr || (slot.result != null ? slot.result.toFixed(2) : ''),
              numericVal,
              name: slot.name ?? slot.placeholder ?? '',
              country: slot.country ?? '',
              waves: surferWaves
            };
          });

          if (hasResults) bodyData.sort((a, b) => b.numericVal - a.numericVal);

          // Heat sub-header row
          const heatLabel = `  Heat ${heat.heatNumber}  ${hasResults ? '— RÉSULTATS' : '— PRÉVISIONS'}`;
          const heatLabelColor = hasResults ? DS.greenDark : DS.gray700;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(...heatLabelColor);
          doc.text(heatLabel, MARGIN, cursorY + 2);
          cursorY += 7;

          const headRow = ['#', 'LYCRA', 'TOTAL', 'SURFEUR', 'PAYS'];
          if (hasResults) for (let i = 1; i <= currentHeatMaxWaves; i++) headRow.push(`V${i}`);

          const usableWidth = pageW - MARGIN * 2;
          const baseWidths = {
            rank: 12,
            lycra: 48,
            total: 28,
            surfer: 110,
            country: 52,
          };
          const reservedWidth =
            baseWidths.rank +
            baseWidths.lycra +
            baseWidths.total +
            baseWidths.surfer +
            baseWidths.country;
          const waveColW = hasResults
            ? clamp((usableWidth - reservedWidth) / Math.max(currentHeatMaxWaves, 1), 14, 28)
            : 0;
          const surferColW = clamp(
            usableWidth - (
              baseWidths.rank +
              baseWidths.lycra +
              baseWidths.total +
              baseWidths.country +
              currentHeatMaxWaves * waveColW
            ),
            88,
            140
          );
          const countryColW = clamp(
            usableWidth - (
              baseWidths.rank +
              baseWidths.lycra +
              baseWidths.total +
              surferColW +
              currentHeatMaxWaves * waveColW
            ),
            40,
            72
          );
          const tableFontSize = waveColW > 0 && waveColW <= 16 ? 6 : 8;
          const headFontSize = waveColW > 0 && waveColW <= 16 ? 6 : 7;
          const colW: Record<number, any> = {
            0: { cellWidth: baseWidths.rank, halign: 'center' as const, fontSize: tableFontSize },
            1: { cellWidth: baseWidths.lycra, halign: 'center' as const, fontStyle: 'bold', overflow: 'hidden', fontSize: tableFontSize },
            2: { cellWidth: baseWidths.total, halign: 'center' as const, fontStyle: 'bold', fontSize: tableFontSize },
            3: { cellWidth: surferColW, halign: 'left' as const, fontStyle: 'bold', fontSize: 8 },
            4: { cellWidth: countryColW, halign: 'left' as const, fontSize: tableFontSize, overflow: 'hidden' },
          };
          for (let i = 0; i < currentHeatMaxWaves; i++) {
            colW[5 + i] = { cellWidth: waveColW, halign: 'center' as const, fontSize: tableFontSize, overflow: 'hidden' };
          }

          autoTable(doc, {
            startY: cursorY,
            head: [headRow],
            body: bodyData.map((d, i) => {
              const row: (string | number)[] = [i + 1, d.lycra, d.score, d.name, d.country];
              if (hasResults) for (let w = 0; w < currentHeatMaxWaves; w++) {
                row.push(d.waves && d.waves[w] !== undefined && d.waves[w] > 0 ? d.waves[w].toFixed(2) : '—');
              }
              return row;
            }),
            theme: 'plain',
            styles: {
              font: 'helvetica',
              fontSize: tableFontSize,
              cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
              halign: 'center',
              valign: 'middle',
              textColor: DS.gray900,
            },
            headStyles: {
              fillColor: hasResults ? DS.greenDark : DS.navyLight,
              textColor: DS.white,
              fontStyle: 'bold',
              fontSize: headFontSize,
              cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
            },
            columnStyles: colW,
            alternateRowStyles: { fillColor: DS.gray50 },
            tableLineColor: DS.gray200,
            tableLineWidth: 0.2,
            margin: { left: MARGIN, right: MARGIN },
            didParseCell: (data) => {
              // Lycra colour cell — no word-wrap, centred
              if (data.column.index === 1) {
                data.cell.styles.overflow = 'hidden';
              }
              // PAYS cell — no word-wrap
              if (data.column.index === 4) {
                data.cell.styles.overflow = 'hidden';
              }
              // Wave score cells — no word-wrap
              if (data.column.index >= 5) {
                data.cell.styles.overflow = 'hidden';
              }
              if (data.section === 'body' && data.column.index === 1) {
                const label = normalizeLycraForPdf(String(data.cell.raw ?? ''));
                const lycra = LYCRA_COLOURS[label];
                if (lycra) {
                  data.cell.styles.fillColor = lycra.fill;
                  data.cell.styles.textColor = lycra.text;
                }
              }
              // Best-2 / Total column
              if (hasResults && data.section === 'body' && data.column.index === 2) {
                if (data.row.index === 0) {
                  data.cell.styles.fillColor = [254, 252, 232]; // gold tint for 1st
                  data.cell.styles.textColor = [120, 53, 15];
                } else {
                  data.cell.styles.textColor = DS.greenDark;
                }
              }
            }
          });

          cursorY = (doc as any).lastAutoTable.finalY + 10;
        });

        cursorY += 8;
      });
    };

    renderRounds(mainRounds, false);
    if (repRounds.length > 0) renderRounds(repRounds, true);
  });

  // ============================================================
  //  FOOTER – every content page
  // ============================================================
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(...DS.navy);
    doc.rect(0, pageH - 20, pageW, 20, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DS.gray400);
    doc.text(`${eventName.toUpperCase()} — RAPPORT COMPLET DE LA COMPÉTITION`, MARGIN, pageH - 7);
    doc.text(`Page ${i - 1} sur ${pageCount - 1}`, pageW - MARGIN, pageH - 7, { align: 'right' });
  }

  doc.save(`${slugify(eventName)}_competition_complete.pdf`);
}

export interface FinalRankingExportPayload {
  eventName: string;
  organizer?: string;
  date?: string;
  heats: HeatRow[];
  scores: Record<string, Score[]>;
  interferenceCalls: Record<string, InterferenceCall[]>;
  participants: ParticipantRecord[];
  divisions: string[];
}

export function exportFinalRankingToPDF(payload: FinalRankingExportPayload) {
  const { eventName, organizer, date, heats, scores, interferenceCalls, participants, divisions } = payload;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const MARGIN = 40;

  let isFirstPage = true;

  divisions.forEach((division) => {
    const rankings = calculateFinalRankings(division, heats, scores, interferenceCalls, participants);
    if (rankings.length === 0) return;

    if (!isFirstPage) {
      doc.addPage();
    }
    isFirstPage = false;

    // Header per division
    doc.setFillColor(...DS.navy);
    doc.rect(0, 0, pageW, 100, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text(eventName.toUpperCase(), MARGIN, 45);

    doc.setFontSize(14);
    doc.setTextColor(...DS.gold);
    doc.text(`CLASSEMENT FINAL – ${division.toUpperCase()}`, MARGIN, 70);

    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text([organizer, date].filter(Boolean).join('  •  '), MARGIN, 88);

    // Prepare table data for multi-column (2 columns)
    const bodyEntries = rankings.map(r => [
      r.rank,
      r.name.toUpperCase(),
      r.country || '',
      (Number(r.heatTotal) || 0).toFixed(2),
      r.points
    ]);

    // Split for 2 columns to look like the ISA model
    const half = Math.ceil(bodyEntries.length / 2);
    const leftCol = bodyEntries.slice(0, half);
    const rightCol = bodyEntries.slice(half);

    const tableConfig = {
      head: [['Place', 'Name', 'NOC', 'Total', 'Points']],
      theme: 'grid' as const,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
      columnStyles: {
        0: { halign: 'center' as const, cellWidth: 35 },
        1: { fontStyle: 'bold' as const },
        2: { halign: 'center' as const, cellWidth: 40 },
        3: { halign: 'right' as const, cellWidth: 44, fontStyle: 'bold' as const },
        4: { halign: 'right' as const, cellWidth: 44, fontStyle: 'bold' as const }
      }
    };

    autoTable(doc, {
      ...tableConfig,
      body: leftCol,
      startY: 120,
      margin: { left: MARGIN, right: pageW / 2 + 10 },
    });

    if (rightCol.length > 0) {
      autoTable(doc, {
        ...tableConfig,
        body: rightCol,
        startY: 120,
        margin: { left: pageW / 2 + 10, right: MARGIN },
      });
    }
  });

  // Global Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Généré par Antigravity Scoring System – Modèle ISA Individual Places`, pageW / 2, pageH - 20, { align: 'center' });
  }

  doc.save(`${slugify(eventName)}_final_rankings.pdf`);
}
