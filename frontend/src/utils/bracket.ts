import { generatePreviewHeats } from './heatGeneration';
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
}

export interface ComputeResult {
  rounds: RoundSpec[];
  repechage?: RoundSpec[];
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
    normalized.startsWith('Meilleur 2e') ||
    /^R\d+\s*-\s*H\d+/i.test(normalized) ||
    normalized === 'BYE'
  );
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

  const rawPlan = generatePreviewHeats(
    legacyParticipants, 
    format === 'single-elim' ? 'elimination' : 'repechage', 
    seriesSize
  );

  const rounds: RoundSpec[] = rawPlan.map(plan => {
    return {
      name: plan.round === rawPlan.length && rawPlan.length > 1 ? 'Finale' : `Round ${plan.round}`,
      roundNumber: plan.round,
      heats: plan.heats.map(heat => {
        return {
          heatNumber: heat.heat_number,
          roundRef: `R${heat.round}-H${heat.heat_number}`,
          slots: heat.surfers.map(surfer => {
            const isPlaceholder = isBracketPlaceholderName(surfer.name);
            const slotColor = surfer.color?.toUpperCase() as HeatColor;

            if (isPlaceholder) {
              return {
                placeholder: surfer.name,
                color: slotColor,
                bye: surfer.name === 'BYE'
              };
            }

            const participant = participants.find(p => p.name === surfer.name || p.seed === surfer.seed);
            
            return {
              seed: participant?.seed ?? surfer.seed,
              name: surfer.name,
              country: surfer.country,
              license: participant?.license,
              participantId: participant?.id,
              color: slotColor,
            };
          })
        };
      })
    };
  });
  
  return { rounds };
}
