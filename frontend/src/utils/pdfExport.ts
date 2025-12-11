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

export function exportBracketToPDF(eventName: string, category: string, rounds: RoundSpec[], repechage?: RoundSpec[], surferNames?: Record<string, string>) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt' });
  const width = doc.internal.pageSize.getWidth();
  const renderRound = (round: RoundSpec) => {
    // Each round starts on a dedicated page with a centered header.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`${eventName.toUpperCase()} – ${category.toUpperCase()}`, width / 2, 60, { align: 'center' });
    doc.setFontSize(14);
    doc.text(round.name.toUpperCase(), width / 2, 90, { align: 'center' });

    let startY = 120;
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
