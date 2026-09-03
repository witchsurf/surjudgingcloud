import { generatePreviewHeats } from './heatGeneration';
import { buildManOnManBracket } from './manOnManBracket';
import type { HeatColor } from './colorUtils';
import type { ParticipantSeed } from './seeding';

export interface HeatSlotSpec {
  seed?: number;
  name?: string;
  country?: string;
  license?: string;
  participantId?: number;
  placeholder?: string;
  bye?: boolean;
  color?: HeatColor;
  result?: number | null;
}

export interface HeatSpec {
  heatNumber: number;
  slots: HeatSlotSpec[];
  roundRef?: string;
  heatId?: string;
  status?: string;
}

export interface RoundSpec {
  name: string;
  roundNumber: number;
  heats: HeatSpec[];
}

export type FormatType = 'single-elim' | 'repechage';
export type VariantType = 'V1' | 'V2';

export interface HybridPlan {
  enabled: boolean;
  round2HeatSize: 2 | 3 | 4;
  round2Advance: 1 | 2;
}

export interface ComputeOptions {
  format: FormatType;
  preferredHeatSize?: number | 'auto';
  variant?: VariantType;
  seedingMethod?: 'snake';
  hybridPlan?: HybridPlan;
  manOnManFromRound?: number;
  promoteBestEliminated?: boolean;
  promoteBestSecond?: boolean;
}

export interface ComputeResult {
  rounds: RoundSpec[];
  repechage?: RoundSpec[];
  progressionEdges?: Array<{
    targetRound: number;
    targetHeat: number;
    targetPosition: number;
    sourceRound: number;
    sourceHeat: number;
    sourcePosition: number;
    type: 'COMPETITION_RESULT' | 'AUTO_ADVANCE_BYE';
  }>;
}

const isBracketPlaceholderName = (value?: string | null) => {
  const normalized = (value || '').trim();
  if (!normalized) return false;
  return (
    normalized.startsWith('Qualifié') ||
    normalized.startsWith('Winner') ||
    normalized.startsWith('Vainqueur') ||
    normalized.startsWith('Repêchage') ||
    normalized.startsWith('Finaliste') ||
    /^Meilleur\s+\d+e\s+R\d+/i.test(normalized) ||
    /^R\d+\s*-\s*H\d+/i.test(normalized) ||
    normalized === 'BYE'
  );
};

const parseProgressionSource = (value?: string | null) => {
  const match = (value ?? '').trim().match(/R(\d+)\s*-\s*H(\d+)\s*(?:\(\s*P(\d+)\s*\)|\s+P(\d+))/i);
  if (!match) return null;
  return {
    sourceRound: Number(match[1]),
    sourceHeat: Number(match[2]),
    sourcePosition: Number(match[3] ?? match[4]),
  };
};

export function computeHeats(participants: ParticipantSeed[], options: ComputeOptions): ComputeResult {
  const { preferredHeatSize = 'auto', format } = options;
  const seriesSize = preferredHeatSize === 'auto' ? 4 : (typeof preferredHeatSize === 'number' ? preferredHeatSize : 4);

  // Map Participants to format expected by heatGeneration.ts (requires 'seed' to be preserved, id, etc. can be passed along)
  const legacyParticipants = participants.map(p => ({
    ...p,
    // ensure seed is passed for distribution
    seed: p.seed
  }));

  if (options.manOnManFromRound === 1) {
    // Six entrants is the common surf format: three opening duels, then the
    // three winners plus the best second fill two semi-finals. A conventional
    // power-of-two bracket would grant two byes instead, which is not the
    // requested sporting rule.
    if (participants.length === 6) {
      const ranked = [...participants].sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name));
      const firstRound: RoundSpec = {
        name: 'Round 1', roundNumber: 1,
        heats: [[0, 5], [1, 4], [2, 3]].map((pair, index) => ({
          heatNumber: index + 1,
          roundRef: `R1-H${index + 1}`,
          slots: pair.map((rankIndex, slotIndex) => ({
            ...ranked[rankIndex], participantId: ranked[rankIndex].id,
            color: (slotIndex === 0 ? 'ROUGE' : 'BLANC') as HeatColor,
          })),
        })),
      };
      const semiFinals: RoundSpec = {
        name: 'Round 2', roundNumber: 2,
        heats: [
          { heatNumber: 1, roundRef: 'R2-H1', slots: [
            { placeholder: 'Vainqueur R1-H1 (P1)', color: 'ROUGE' },
            { placeholder: 'Vainqueur R1-H2 (P1)', color: 'BLANC' },
          ] },
          { heatNumber: 2, roundRef: 'R2-H2', slots: [
            { placeholder: 'Vainqueur R1-H3 (P1)', color: 'ROUGE' },
            { placeholder: 'Meilleur 2e R1', color: 'BLANC' },
          ] },
        ],
      };
      const finale: RoundSpec = { name: 'Finale', roundNumber: 3, heats: [{ heatNumber: 1, roundRef: 'R3-H1', slots: [
        { placeholder: 'Vainqueur R2-H1 (P1)', color: 'ROUGE' },
        { placeholder: 'Vainqueur R2-H2 (P1)', color: 'BLANC' },
      ] }] };
      return {
        rounds: [firstRound, semiFinals, finale],
        progressionEdges: [
          [1, 1, 1, 2, 1, 1], [1, 2, 1, 2, 1, 2], [1, 3, 1, 2, 2, 1],
          [2, 1, 1, 3, 1, 1], [2, 2, 1, 3, 1, 2],
        ].map(([sourceRound, sourceHeat, sourcePosition, targetRound, targetHeat, targetPosition]) => ({
          sourceRound, sourceHeat, sourcePosition, targetRound, targetHeat, targetPosition,
          type: 'COMPETITION_RESULT' as const,
        })),
      };
    }
    const graph = buildManOnManBracket(participants.length);
    const rankedParticipants = [...participants].sort((left, right) => (
      left.seed - right.seed || left.name.localeCompare(right.name)
    ));
    const participantByRank = new Map(rankedParticipants.map((participant, index) => [index + 1, participant]));
    const heatBySchedule = new Map<string, HeatSpec>();
    const roundsByNumber = new Map<number, RoundSpec>();
    const finalRound = Math.max(...graph.matches.map((match) => match.round));

    graph.matches.forEach((match) => {
      const heat: HeatSpec = {
        heatNumber: match.heatNumber,
        roundRef: `R${match.round}-H${match.heatNumber}`,
        slots: match.round === 1
          ? match.slots.map((rank, index) => {
            const participant = participantByRank.get(rank);
            if (!participant) throw new Error(`Participant de rang ${rank} introuvable`);
            return {
              ...participant,
              participantId: participant.id,
              color: (index === 0 ? 'ROUGE' : 'BLANC') as HeatColor,
            };
          })
          : Array.from({ length: 2 }, (_, index) => ({
            color: (index === 0 ? 'ROUGE' : 'BLANC') as HeatColor,
          })),
      };
      heatBySchedule.set(`${match.round}:${match.heatNumber}`, heat);
      const round = roundsByNumber.get(match.round) ?? {
        name: match.round === finalRound && finalRound > 1 ? 'Finale' : `Round ${match.round}`,
        roundNumber: match.round,
        heats: [],
      };
      round.heats.push(heat);
      roundsByNumber.set(match.round, round);
    });

    graph.edges.forEach((edge) => {
      const target = heatBySchedule.get(`${edge.targetRound}:${edge.targetHeat}`);
      if (!target) throw new Error(`Cible man-on-man R${edge.targetRound}-H${edge.targetHeat} introuvable`);
      const color = (edge.targetPosition === 1 ? 'ROUGE' : 'BLANC') as HeatColor;
      if (edge.type === 'AUTO_ADVANCE_BYE') {
        const participant = participantByRank.get(edge.byeSeed ?? -1);
        if (!participant) throw new Error(`Exempté de rang ${edge.byeSeed ?? '?'} introuvable`);
        target.slots[edge.targetPosition - 1] = {
          ...participant,
          participantId: participant.id,
          color,
        };
      } else {
        target.slots[edge.targetPosition - 1] = {
          placeholder: `Vainqueur R${edge.sourceRound}-H${edge.sourceHeat} (P${edge.sourcePosition})`,
          color,
        };
      }
    });

    return {
      rounds: [...roundsByNumber.values()].sort((a, b) => a.roundNumber - b.roundNumber),
      progressionEdges: graph.edges.map((edge) => ({
        targetRound: edge.targetRound,
        targetHeat: edge.targetHeat,
        targetPosition: edge.targetPosition,
        sourceRound: edge.sourceRound,
        sourceHeat: edge.sourceHeat,
        sourcePosition: edge.sourcePosition,
        type: edge.type,
      })),
    };
  }

  const rawPlan = generatePreviewHeats(
    legacyParticipants, 
    format === 'single-elim' ? 'elimination' : 'repechage', 
    seriesSize,
    { manOnManFromRound: options.manOnManFromRound, promoteBestEliminated: options.promoteBestEliminated, promoteBestSecond: options.promoteBestSecond }
  );

  const progressionEdges: NonNullable<ComputeResult['progressionEdges']> = [];
  // Mixed-format transitions deliberately use the existing production
  // generator above. No parallel bracket or BYE semantics are introduced.

  const rounds: RoundSpec[] = rawPlan.map(plan => {
    return {
      name: plan.round === rawPlan.length && rawPlan.length > 1 ? 'Finale' : `Round ${plan.round}`,
      roundNumber: plan.round,
      heats: plan.heats.map(heat => {
        return {
          heatNumber: heat.heat_number,
          roundRef: `R${heat.round}-H${heat.heat_number}`,
          slots: heat.surfers.map((surfer, slotIndex) => {
            const isPlaceholder = isBracketPlaceholderName(surfer.name);
            const slotColor = surfer.color?.toUpperCase() as HeatColor;

            if (isPlaceholder) {
              const source = parseProgressionSource(surfer.name);
              if (source) {
                progressionEdges.push({
                  targetRound: plan.round,
                  targetHeat: heat.heat_number,
                  targetPosition: slotIndex + 1,
                  ...source,
                  type: 'COMPETITION_RESULT',
                });
              }
              return {
                placeholder: surfer.name,
                color: slotColor,
                bye: surfer.name === 'BYE'
              };
            }

            const participant = participants.find(p => p.name === surfer.name || p.seed === surfer.seed);
            
            return {
              seed: participant?.seed ?? (surfer.seed ?? undefined),
              name: surfer.name,
              country: surfer.country || undefined,
              license: participant?.license,
              participantId: participant?.id,
              color: slotColor,
            };
          })
        };
      })
    };
  });
  
  return { rounds, progressionEdges };
}
