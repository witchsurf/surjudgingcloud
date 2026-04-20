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

  const divisionHeats = heats
    .filter(h => (h.division || '').trim().toUpperCase() === division.trim().toUpperCase())
    .sort((a, b) => b.round - a.round || a.heat_number - b.heat_number);

  if (divisionHeats.length === 0) return [];

  const rounds = divisionHeats.map(h => h.round).filter(r => r != null);
  const maxRound = rounds.length > 0 ? Math.max(...rounds) : 0;
  
  // 1. Calculer les stats de chaque surfeur par heat
  // On identifie pour chaque participant son "terminus" (le dernier heat où il a fini en position d'élimination ou la finale)
  const surferTerminus = new Map<string, {
    round: number;
    position: number;
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
    
    // On extrait les noms présents dans ce heat
    // (On ne peut pas se baser uniquement sur participants[] car certains sont des placeholders)
    // Mais ici on veut les VRAIS noms résolus.
    const surfersFromScores = (heatScores || []).map(s => s?.surfer).filter(Boolean);
    const surfersFromSlots = (heat.slots || []).map((s: any) => s?.name || s?.placeholder).filter(Boolean);
    const uniqueSurfersInHeat = Array.from(new Set([...surfersFromScores, ...surfersFromSlots].map(s => s.toUpperCase())));
    
    const effectiveInterferences = computeEffectiveInterferences(heatInterferences, configuredJudgeCount);

    // Si heat non fermé et pas de scores, on peut avoir des problèmes de ranking.
    // Pour un classement FINAL, on assume que l'évènement est clos ou qu'on veut le rank actuel.
    const stats = calculateSurferStats(
        heatScores, 
        uniqueSurfersInHeat, 
        configuredJudgeCount, 
        12, // max waves default
        true, // allow incomplete
        effectiveInterferences,
        heat.status as any
    );

    const sortedStats = stats.sort((a, b) => (a.rank || 99) - (b.rank || 99));

    sortedStats.forEach((stat) => {
      const surferKey = stat.surfer.toUpperCase();
      
      // Si le surfeur a déjà été marqué comme "avancé" dans un round supérieur, 
      // on ignore ses rounds précédents pour le classement final.
      if (advancedSurfers.has(surferKey)) return;

      // Un surfeur est "éliminé" s'il est 3e ou 4e d'un round < Finale, 
      // ou s'il est dans la Finale (Round max).
      const isFinal = heat.round === maxRound;
      const isEliminated = isFinal || stat.rank > 2;

      if (isEliminated && !surferTerminus.has(surferKey)) {
        // Obtenir le vrai nom depuis participants si possible
        const participant = participants.find(p => {
            const pName = p.name?.trim().toUpperCase();
            const pCat = p.category?.trim().toUpperCase();
            const dName = division.trim().toUpperCase();
            return pName === surferKey && (pCat === dName || !pCat);
        });

        surferTerminus.set(surferKey, {
          round: heat.round,
          position: stat.rank,
          total: stat.bestTwo,
          bestWave: stat.waves?.[0]?.score || 0,
          name: surferKey, // TODO: resolve real name
          country: participant?.country
        });
      }

      if (stat.rank <= 2 && !isFinal) {
        advancedSurfers.add(surferKey);
      }
    });
  }

  // 2. Transformer en liste et trier globalement
  const entries: FinalRankEntry[] = Array.from(surferTerminus.values()).map(t => ({
    rank: 0, // calculated later
    name: t.name,
    country: t.country,
    points: 0,
    exitRound: t.round,
    exitPosition: t.position,
    heatTotal: t.total,
    bestWave: t.bestWave,
    division
  }));

  // Tri ISA :
  // 1. Round d'élimination (DESC)
  // 2. Position dans le heat (ASC)
  // 3. Total de heat (DESC)
  // 4. Meilleure vague (DESC)
  entries.sort((a, b) => {
    if (a.exitRound !== b.exitRound) return b.exitRound - a.exitRound;
    if (a.exitPosition !== b.exitPosition) return a.exitPosition - b.exitPosition;
    if (a.heatTotal !== b.heatTotal) return b.heatTotal - a.heatTotal;
    return b.bestWave - a.bestWave;
  });

  // 3. Assigner les rangs et points
  // Attention : En ISA, les gens éliminés au même round avec la même position partagent souvent le même rang.
  // Ex: Les deux 3e de demi-finale sont tous les deux 5e.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    
    // Déterminer le rang "groupe"
    // (Dans une finale à 4, c'est 1, 2, 3, 4. Dans des demis, c'est 5, 5, 7, 7)
    if (entry.exitRound === maxRound) {
        entry.rank = entry.exitPosition;
    } else {
        // Calcul du rang ISA pour les tours précédents
        // Rang = 1 + (Nombre de surfeurs qualifiés pour rounds suivants) + (Offset selon position)
        // Mais plus simplement : si même round et même position, même rang.
        const prev = entries[i-1];
        if (prev && prev.exitRound === entry.exitRound && prev.exitPosition === entry.exitPosition) {
            entry.rank = prev.rank;
        } else {
            entry.rank = i + 1;
        }
    }
    
    entry.points = getPointsForRank(entry.rank);
  }

  return entries;
}
