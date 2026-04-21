import { calculateSurferStats } from './scoring';
import { computeEffectiveInterferences } from './interference';
import type { Score, InterferenceCall } from '../types';
import type { ParticipantRecord } from '../api/modules/participants.api';
import type { HeatRow } from '../api/modules/heats.api';

export interface FinalRankEntry {
  rank: number;
  name: string;
  country?: string | null;
  points: number;
  exitRound: number;
  exitPosition: number;
  qualifiers: number;
  heatTotal: number;
  bestWave: number;
  division: string;
}

/**
 * Barème "Français" (Option 3 approuvée)
 * Valorise les écarts en finale.
 */
export function getPointsForRank(rank: number): number {
  if (rank === 1) return 1000;
  if (rank === 2) return 700;
  if (rank === 3) return 540;
  if (rank === 4) return 440;
  if (rank <= 6) return 360;  // Equal 5th
  if (rank <= 8) return 320;  // Equal 7th
  if (rank <= 12) return 280; // Equal 9th
  if (rank <= 16) return 240; // Equal 13th
  if (rank <= 24) return 200; // Equal 17th
  if (rank <= 32) return 160; // Equal 25th
  if (rank <= 48) return 120; // Equal 33rd
  if (rank <= 64) return 80;  // Equal 49th
  return Math.max(0, 80 - (Math.floor((rank - 65) / 16) * 20));
}

export function calculateFinalRankings(
  division: string,
  heats: HeatRow[],
  scores: Record<string, Score[]>,
  interferenceCalls: Record<string, InterferenceCall[]>,
  participants: ParticipantRecord[],
  configuredJudgeCount: number = 3
): FinalRankEntry[] {
  if (!heats || !Array.isArray(heats)) return [];
  if (!scores) scores = {};
  if (!interferenceCalls) interferenceCalls = {};
  if (!participants) participants = [];

  const normalizeHeatColorKey = (value: string) => {
    const key = (value || '').trim().toUpperCase();
    if (!key) return '';
    if (key === 'RED') return 'ROUGE';
    if (key === 'WHITE') return 'BLANC';
    if (key === 'YELLOW') return 'JAUNE';
    if (key === 'BLUE') return 'BLEU';
    if (key === 'GREEN') return 'VERT';
    if (key === 'BLACK') return 'NOIR';
    return key;
  };

  const resolveParticipantById = (participantId?: number | null) => {
    if (!participantId) return null;
    return participants.find((p) => Number(p.id) === Number(participantId)) ?? null;
  };

  const resolveParticipantByName = (name: string) => {
    const normalizedName = (name || '').trim().toUpperCase();
    if (!normalizedName) return null;
    const divisionKey = (division || '').trim().toUpperCase();
    return (
      participants.find((p) => {
        const pName = (p.name || '').trim().toUpperCase();
        const pDivision = (p.category || '').trim().toUpperCase();
        return pName === normalizedName && (pDivision === divisionKey || !pDivision);
      }) ?? null
    );
  };

  const normalizePlaceholderKey = (value: string) =>
    (value || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[()[\]]/g, ' ')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const isPlaceholderLike = (value?: string | null) => {
    if (!value) return false;
    const normalized = normalizePlaceholderKey(value);
    return normalized.includes('QUALIFI') ||
      normalized.includes('FINALISTE') ||
      normalized.includes('REPECH') ||
      normalized.includes('VAINQUEUR') ||
      normalized.includes('WINNER') ||
      normalized.includes('MEILLEUR 2') ||
      /^R\s*\d+/.test(normalized) ||
      /^RP\s*\d+/.test(normalized) ||
      normalized === 'BYE';
  };

  const normalizeDivisionKey = (value: string) =>
    (value || '').trim().toUpperCase().replace(/[_\s]+/g, ' ').replace(/\s+/g, ' ');

  const divisionHeats = heats
    .filter((h) => normalizeDivisionKey(h.division || '') === normalizeDivisionKey(division || ''))
    .sort((a, b) => b.round - a.round || a.heat_number - b.heat_number);

  if (divisionHeats.length === 0) return [];

  const rounds = divisionHeats.map(h => h.round).filter(r => r != null);
  const maxRound = rounds.length > 0 ? Math.max(...rounds) : 0;

  const heatsByRound = divisionHeats.reduce<Map<number, HeatRow[]>>((acc, heat) => {
    const key = Number(heat.round || 0);
    const existing = acc.get(key) ?? [];
    existing.push(heat);
    acc.set(key, existing);
    return acc;
  }, new Map());

  const heatByRoundHeatNumber = new Map<string, HeatRow>();
  divisionHeats.forEach((heat) => {
    heatByRoundHeatNumber.set(`${Number(heat.round || 0)}::${Number(heat.heat_number || 0)}`, heat);
  });

  const SEED_ORDER = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'];
  const getSeedPriority = (color: string) => {
    const idx = SEED_ORDER.indexOf((color || '').toUpperCase());
    return idx === -1 ? 99 : idx;
  };

  const parsePlaceholderReference = (value: string): { round: number; heatNumber: number; position: number } | null => {
    const normalized = normalizePlaceholderKey(value);

    // Matches "VAINQUEUR R1-H2 (P1)" / "QUALIFIE R1 H2 P2" / "WINNER R1-H1 P1"
    const m1 = normalized.match(/R\s*(\d+)\s*H\s*(\d+)\s*P\s*(\d+)/);
    if (m1) return { round: Number(m1[1]), heatNumber: Number(m1[2]), position: Number(m1[3]) };

    // Matches legacy compact "R1 H2" without P -> can't resolve deterministically
    return null;
  };

  const resolvedPlaceholderCache = new Map<string, { name: string; country?: string | null; participantId?: number | null } | null>();

  const resolvePlaceholderToSurfer = (placeholderText: string) => {
    const cacheKey = normalizePlaceholderKey(placeholderText);
    if (resolvedPlaceholderCache.has(cacheKey)) return resolvedPlaceholderCache.get(cacheKey) ?? null;

    const ref = parsePlaceholderReference(placeholderText);
    if (!ref) {
      resolvedPlaceholderCache.set(cacheKey, null);
      return null;
    }

    const sourceHeat = heatByRoundHeatNumber.get(`${ref.round}::${ref.heatNumber}`);
    if (!sourceHeat) {
      resolvedPlaceholderCache.set(cacheKey, null);
      return null;
    }

    const sourceScores = scores[sourceHeat.id] || [];
    if (!sourceScores.length) {
      resolvedPlaceholderCache.set(cacheKey, null);
      return null;
    }

    const slotByColor = new Map<string, { name?: string; country?: string | null; participantId?: number | null }>();
    const slots = Array.isArray(sourceHeat.slots) ? sourceHeat.slots : [];
    slots.forEach((slot: any) => {
      if (!slot || slot.bye) return;
      const normalizedColor = normalizeHeatColorKey(String(slot.color || ''));
      if (!normalizedColor) return;
      slotByColor.set(normalizedColor, {
        name: slot.name || slot.placeholder || undefined,
        country: slot.country ?? null,
        participantId: slot.participantId ?? slot.participant_id ?? null,
      });
    });

    const colorsFromScores = sourceScores
      .map((s) => normalizeHeatColorKey(String(s?.surfer || '')))
      .filter(Boolean);
    const colorsFromSlots = Array.from(slotByColor.keys());
    const uniqueColorsInHeat = Array.from(new Set([...colorsFromSlots, ...colorsFromScores]));
    if (uniqueColorsInHeat.length === 0) {
      resolvedPlaceholderCache.set(cacheKey, null);
      return null;
    }

    const heatInterferences = interferenceCalls[sourceHeat.id] || [];
    const effectiveInterferences = computeEffectiveInterferences(heatInterferences, configuredJudgeCount);
    const maxWaves = Math.max(1, ...sourceScores.map((s) => Number((s as any)?.wave_number) || Number((s as any)?.wave) || 0));
    const stats = calculateSurferStats(
      sourceScores.map((score) => ({ ...score, surfer: normalizeHeatColorKey(String(score.surfer || '')) })),
      uniqueColorsInHeat,
      configuredJudgeCount,
      maxWaves,
      true,
      effectiveInterferences,
      sourceHeat.status as any
    );

    const orderedStats = [...stats].sort((a, b) => {
      const rankDiff = (a.rank ?? 99) - (b.rank ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return getSeedPriority(a.surfer) - getSeedPriority(b.surfer);
    });

    const picked = orderedStats[ref.position - 1];
    if (!picked) {
      resolvedPlaceholderCache.set(cacheKey, null);
      return null;
    }

    const pickedColor = normalizeHeatColorKey(picked.surfer);
    const slotInfo = slotByColor.get(pickedColor);
    const resolvedName = (slotInfo?.name || '').trim();
    if (!resolvedName || isPlaceholderLike(resolvedName)) {
      resolvedPlaceholderCache.set(cacheKey, null);
      return null;
    }

    const resolved = { name: resolvedName, country: slotInfo?.country ?? null, participantId: slotInfo?.participantId ?? null };
    resolvedPlaceholderCache.set(cacheKey, resolved);
    return resolved;
  };

  const nonByeSlotCountByRound = new Map<number, number>();
  heatsByRound.forEach((roundHeats, roundNumber) => {
    const total = roundHeats.reduce((sum, heat) => {
      const slots = Array.isArray(heat.slots) ? heat.slots : [];
      if (slots.length === 0) return sum + Math.max(0, Number(heat.heat_size) || 0);
      const count = slots.filter((s: any) => !s?.bye).length;
      return sum + count;
    }, 0);
    nonByeSlotCountByRound.set(roundNumber, total);
  });
  
  // 1. Calculer les stats de chaque surfeur par heat
  // On identifie pour chaque participant son "terminus" (le dernier heat où il a fini en position d'élimination ou la finale)
  const surferTerminus = new Map<string, {
    round: number;
    position: number;
    qualifiers: number;
    total: number;
    bestWave: number;
    name: string;
    country?: string | null;
  }>();

  // On track qui a avancé pour ne pas les classer prématurément
  const advancedSurfers = new Set<string>();

  // On process du round le plus haut vers le plus bas
  const sortedHeats = [...divisionHeats].sort((a, b) => b.round - a.round);

  for (const heat of sortedHeats) {
    const heatScores = scores[heat.id] || [];
    const heatInterferences = interferenceCalls[heat.id] || [];
    if (!heatScores.length) continue;
    
    const slotByColor = new Map<string, { name?: string; country?: string | null; participantId?: number | null }>();
    const slots = Array.isArray(heat.slots) ? heat.slots : [];
    slots.forEach((slot: any) => {
      if (!slot || slot.bye) return;
      const normalizedColor = normalizeHeatColorKey(String(slot.color || ''));
      if (!normalizedColor) return;
      slotByColor.set(normalizedColor, {
        name: slot.name || slot.placeholder || undefined,
        country: slot.country ?? null,
        participantId: slot.participantId ?? slot.participant_id ?? null,
      });
    });

    const colorsFromScores = (heatScores || [])
      .map((s) => normalizeHeatColorKey(String(s?.surfer || '')))
      .filter(Boolean);
    const colorsFromSlots = Array.from(slotByColor.keys());
    const uniqueColorsInHeat = Array.from(new Set([...colorsFromSlots, ...colorsFromScores]));
    if (uniqueColorsInHeat.length === 0) continue;
    
    const effectiveInterferences = computeEffectiveInterferences(heatInterferences, configuredJudgeCount);

    // Si heat non fermé et pas de scores, on peut avoir des problèmes de ranking.
    // Pour un classement FINAL, on assume que l'évènement est clos ou qu'on veut le rank actuel.
    const maxWaves = Math.max(1, ...heatScores.map((s) => Number((s as any)?.wave_number) || Number((s as any)?.wave) || 0));
    const stats = calculateSurferStats(
        (heatScores || []).map((score) => ({ ...score, surfer: normalizeHeatColorKey(String(score.surfer || '')) })), 
        uniqueColorsInHeat, 
        configuredJudgeCount, 
        maxWaves,
        true, // allow incomplete
        effectiveInterferences,
        heat.status as any
    );

    const sortedStats = stats.sort((a, b) => (a.rank || 99) - (b.rank || 99));

    sortedStats.forEach((stat) => {
      const heatColor = normalizeHeatColorKey(stat.surfer);
      const slotInfo = slotByColor.get(heatColor);
      const rawSlotName = slotInfo?.name || heatColor;
      const placeholderResolved = isPlaceholderLike(rawSlotName) ? resolvePlaceholderToSurfer(rawSlotName) : null;
      const displayNameCandidate = placeholderResolved?.name || rawSlotName;
      const participant =
        resolveParticipantById(placeholderResolved?.participantId ?? slotInfo?.participantId) ??
        resolveParticipantByName(displayNameCandidate);
      const resolvedName = (participant?.name || displayNameCandidate || heatColor).trim();
      if (!resolvedName) return;
      if (isPlaceholderLike(resolvedName)) return;

      const surferKey = participant?.id != null
        ? `id:${Number(participant.id)}`
        : `name:${resolvedName.toUpperCase()}`;

      // Si le surfeur a déjà été marqué comme "avancé" dans un round supérieur, on ignore ses rounds précédents.
      if (advancedSurfers.has(surferKey)) return;

      // Un surfeur est "éliminé" s'il est 3e ou 4e d'un round < Finale, 
      // ou s'il est dans la Finale (Round max).
      const isFinal = heat.round === maxRound;
      const heatSize = Math.max(0, Number(heat.heat_size) || uniqueColorsInHeat.length);
      const qualifiers = heatSize <= 2 ? 1 : 2;
      const isEliminated = isFinal || stat.rank > qualifiers;

      if (isEliminated && !surferTerminus.has(surferKey)) {
        surferTerminus.set(surferKey, {
          round: heat.round,
          position: stat.rank,
          qualifiers,
          total: stat.bestTwo,
          bestWave: Math.max(0, ...(stat.waves || []).map((w) => Number(w?.score) || 0)),
          name: resolvedName,
          country: placeholderResolved?.country ?? slotInfo?.country ?? participant?.country ?? null
        });
      }

      if (stat.rank <= qualifiers && !isFinal) {
        advancedSurfers.add(surferKey);
      }
    });
  }

  // 2. Transformer en liste et trier globalement
  const entries: FinalRankEntry[] = Array.from(surferTerminus.values())
    .map(t => ({
      rank: 0, // calculated later
      name: t.name,
      country: t.country,
      points: 0,
      exitRound: t.round,
      exitPosition: t.position,
      qualifiers: t.qualifiers,
      heatTotal: t.total,
      bestWave: t.bestWave,
      division
    }));

  // 3. Assigner les rangs et points
  // Places ISA (Individual Places):
  // - Finale (dernier round): place = position (1..N)
  // - Autres rounds: base = (survivants au round suivant) + 1, puis offset par position éliminatoire.
  const heatCountByRound = new Map<number, number>();
  heatsByRound.forEach((roundHeats, roundNumber) => heatCountByRound.set(roundNumber, roundHeats.length));

  entries.forEach((entry) => {
    if (entry.exitRound === maxRound) {
      entry.rank = entry.exitPosition;
      return;
    }

    const nextRoundSurvivors = nonByeSlotCountByRound.get(entry.exitRound + 1);
    const fallbackSurvivors = (() => {
      const heatCount = heatCountByRound.get(entry.exitRound) ?? 0;
      return heatCount > 0 ? heatCount * entry.qualifiers : 0;
    })();
    const survivors = Math.max(0, Number(nextRoundSurvivors ?? fallbackSurvivors) || 0);
    const heatCount = Math.max(1, Number(heatCountByRound.get(entry.exitRound) ?? 1));
    const firstEliminationPos = entry.qualifiers + 1;
    const eliminationOffset = Math.max(0, entry.exitPosition - firstEliminationPos);
    entry.rank = survivors + 1 + eliminationOffset * heatCount;
  });

  // Break ties using scores: within a same "base rank" group (e.g. equal 5th),
  // order by performance and assign unique ranks (5,6 instead of 5,5).
  const perfSort = (a: FinalRankEntry, b: FinalRankEntry) => {
    if (a.exitRound !== b.exitRound) return b.exitRound - a.exitRound;
    if (a.exitPosition !== b.exitPosition) return a.exitPosition - b.exitPosition;
    if (a.heatTotal !== b.heatTotal) return b.heatTotal - a.heatTotal;
    if (a.bestWave !== b.bestWave) return b.bestWave - a.bestWave;
    return a.name.localeCompare(b.name);
  };

  const byBaseRank = new Map<number, FinalRankEntry[]>();
  entries.forEach((entry) => {
    const baseRank = Number(entry.rank) || 0;
    const group = byBaseRank.get(baseRank) ?? [];
    group.push(entry);
    byBaseRank.set(baseRank, group);
  });

  Array.from(byBaseRank.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([baseRank, group]) => {
      if (group.length <= 1) return;
      group.sort(perfSort);
      group.forEach((entry, index) => {
        entry.rank = baseRank + index;
      });
    });

  // Points follow the final rank.
  entries.forEach((entry) => {
    entry.points = getPointsForRank(entry.rank);
  });

  // Tri final: place asc, puis perf desc pour stabiliser.
  entries.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return perfSort(a, b);
  });

  return entries;
}
