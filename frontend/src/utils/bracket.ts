import { determineHeatCount, determineHeatSize, distributeSeedsSnake, ParticipantSeed, HeatSeedMap } from './seeding';
import { getColorSet, HeatColor } from './colorUtils';

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
}

export interface RoundSpec {
  name: string;
  roundNumber: number;
  heats: HeatSpec[];
}

export type FormatType = 'single-elim' | 'repechage';
export type VariantType = 'V1' | 'V2';

export interface ComputeOptions {
  format: FormatType;
  preferredHeatSize?: number | 'auto';
  variant?: VariantType;
  seedingMethod?: 'snake';
}

export interface ComputeResult {
  rounds: RoundSpec[];
  repechage?: RoundSpec[];
}

interface SlotReference {
  sourceRound: number;
  heatNumber: number;
  position: number;
}

const makePlaceholder = (ref: SlotReference, prefix = 'R'): string => {
  // Generates format: "R1-H1-P3" compatible with parsePlaceholder regex in supabaseClient.ts
  // Regex: /^(RP?)(\d+)-H(\d+)-P(\d+)$/
  const base = `${prefix}${ref.sourceRound}-H${ref.heatNumber}`;
  return `${base}-P${ref.position}`;
};

function toHeatSlots(map: HeatSeedMap[], participants: ParticipantSeed[]): HeatSpec[] {
  const bySeed = new Map<number, ParticipantSeed>();
  participants.forEach((p) => bySeed.set(p.seed, p));

  return map.map(({ heatNumber, seeds }) => {
    const colors = getColorSet(seeds.length || 0);
    const slots = seeds.map<HeatSlotSpec>((seed, index) => {
      if (seed == null) {
        return { bye: true, placeholder: 'BYE', color: colors[index] };
      }
      const participant = bySeed.get(seed);
      if (!participant) {
        return { bye: true, placeholder: `Seed ${seed}`, color: colors[index] };
      }
      return {
        seed: participant.seed,
        name: participant.name,
        country: participant.country,
        license: participant.license,
        participantId: participant.id,
        color: colors[index],
      };
    });
    return {
      heatNumber,
      slots,
      roundRef: `R1-H${heatNumber}`,
    };
  });
}

function distributeReferencesSnake(refs: SlotReference[], heatCount: number, heatSize: number): SlotReference[][] {
  const heats: SlotReference[][] = Array.from({ length: heatCount }, () => []);
  let index = 0;
  let direction: 1 | -1 = 1;

  for (let i = 0; i < refs.length; i += 1) {
    heats[index].push(refs[i]);

    if (heatCount === 1) continue;

    if (direction === 1) {
      if (index === heatCount - 1) direction = -1;
      else index += 1;
    } else if (index === 0) direction = 1;
    else index -= 1;
  }

  const totalSlots = heatCount * heatSize;
  let added = refs.length;
  if (added < totalSlots) {
    for (let heatIdx = 0; heatIdx < heats.length && added < totalSlots; heatIdx += 1) {
      while (heats[heatIdx].length < heatSize && added < totalSlots) {
        heats[heatIdx].push({ sourceRound: 0, heatNumber: 0, position: 0 });
        added += 1;
      }
    }
  }

  return heats;
}

export function buildSingleElimNextRounds(round1: HeatSpec[], variant: VariantType = 'V1'): RoundSpec[] {
  const results: RoundSpec[] = [];
  const qualifiers: SlotReference[] = [];

  round1.forEach((heat) => {
    qualifiers.push({ sourceRound: 1, heatNumber: heat.heatNumber, position: 1 });
    qualifiers.push({ sourceRound: 1, heatNumber: heat.heatNumber, position: 2 });
  });

  if (qualifiers.length === 0) {
    return results;
  }

  if (variant === 'V2') {
    const r2HeatSize = 2;
    const r2HeatCount = Math.max(1, Math.ceil(qualifiers.length / r2HeatSize));
    const r2Distribution = distributeReferencesSnake(qualifiers, r2HeatCount, r2HeatSize);

    const round2: RoundSpec = {
      name: qualifiers.length <= 2 ? 'Finale' : 'Round 2',
      roundNumber: 2,
      heats: r2Distribution.map((refs, idx) => {
        const colorSet = getColorSet(r2HeatSize);
        return {
          heatNumber: idx + 1,
          slots: refs.map((ref, slotIdx) => {
            if (ref.sourceRound === 0) {
              return { bye: true, placeholder: 'BYE', color: colorSet[slotIdx] };
            }
            return { placeholder: makePlaceholder(ref), color: colorSet[slotIdx] };
          }),
          roundRef: `R2-H${idx + 1}`,
        };
      }),
    };

    results.push(round2);

    if (qualifiers.length > 2) {
      const finalRefs = round2.heats.map((heat) => ({
        sourceRound: 2,
        heatNumber: heat.heatNumber,
        position: 1,
      }));

      const finalRound: RoundSpec = {
        name: 'Finale',
        roundNumber: 3,
        heats: [
          {
            heatNumber: 1,
            slots: finalRefs.map((ref, slotIdx) => ({
              placeholder: makePlaceholder(ref),
              color: getColorSet(finalRefs.length)[slotIdx],
            })),
            roundRef: 'Finale-H1',
          },
        ],
      };

      results.push(finalRound);
    }

    return results;
  }

  // Variant V1
  const r2HeatSize = 3;
  const r2HeatCount = Math.max(1, Math.ceil(qualifiers.length / r2HeatSize));
  const r2Distribution = distributeReferencesSnake(qualifiers, r2HeatCount, r2HeatSize);

  const round2: RoundSpec = {
    name: qualifiers.length <= 3 ? 'Finale' : 'Round 2',
    roundNumber: 2,
    heats: r2Distribution.map((refs, idx) => {
      const colorSet = getColorSet(r2HeatSize);
      return {
        heatNumber: idx + 1,
        slots: refs.map((ref, slotIdx) => {
          if (ref.sourceRound === 0) {
            return { bye: true, placeholder: 'BYE', color: colorSet[slotIdx] };
          }
          return { placeholder: makePlaceholder(ref), color: colorSet[slotIdx] };
        }),
        roundRef: `R2-H${idx + 1}`,
      };
    }),
  };

  results.push(round2);

  if (qualifiers.length > 3) {
    const finalists: SlotReference[] = [];
    round2.heats.forEach((heat) => {
      finalists.push({ sourceRound: 2, heatNumber: heat.heatNumber, position: 1 });
      finalists.push({ sourceRound: 2, heatNumber: heat.heatNumber, position: 2 });
    });

    const finalRound: RoundSpec = {
      name: 'Finale',
      roundNumber: 3,
      heats: [
        {
          heatNumber: 1,
          slots: finalists.map((ref, slotIdx) => ({
            placeholder: makePlaceholder(ref),
            color: getColorSet(finalists.length)[slotIdx],
          })),
          roundRef: 'Finale-H1',
        },
      ],
    };

    results.push(finalRound);
  }

  return results;
}

export function buildRepechageFlows(round1: HeatSpec[], mainRounds: RoundSpec[]): RoundSpec[] {
  const repechage: RoundSpec[] = [];

  const initialLosers: SlotReference[] = [];
  round1.forEach((heat) => {
    heat.slots.forEach((slot, index) => {
      if (slot?.bye) return;
      if (index >= 2) {
        initialLosers.push({ sourceRound: 1, heatNumber: heat.heatNumber, position: index + 1 });
      }
    });
  });

  if (initialLosers.length === 0) {
    return repechage;
  }

  const heatSize = round1[0]?.slots.length ?? 4;
  const heatCount = Math.max(1, Math.ceil(initialLosers.length / heatSize));
  const round1Dist = distributeReferencesSnake(initialLosers, heatCount, heatSize);

  repechage.push({
    name: 'Repechage R1',
    roundNumber: 1,
    heats: round1Dist.map((refs, idx) => {
      const colorSet = getColorSet(heatSize);
      return {
        heatNumber: idx + 1,
        slots: refs.map((ref, slotIdx) => ({
          placeholder: makePlaceholder(ref, 'R'),
          color: colorSet[slotIdx],
        })),
        roundRef: `RP1-H${idx + 1}`,
      };
    }),
  });

  if (mainRounds.length === 0) return repechage;

  let previousRefs = repechage[0].heats.flatMap((heat) => heat.slots.map((_, slotIdx) => ({
    sourceRound: 101,
    heatNumber: heat.heatNumber,
    position: slotIdx + 1,
  })));

  mainRounds.forEach((round, roundIdx) => {
    const losers: SlotReference[] = [];
    round.heats.forEach((heat) => {
      const loserStart = roundIdx === mainRounds.length - 1 ? 2 : 3;
      for (let pos = loserStart; pos <= heat.slots.length; pos += 1) {
        losers.push({ sourceRound: round.roundNumber, heatNumber: heat.heatNumber, position: pos });
      }
    });

    if (losers.length === 0) return;

    const combined = [...previousRefs, ...losers];
    const rpHeatSize = Math.min(heatSize, 4);
    const rpHeatCount = Math.max(1, Math.ceil(combined.length / rpHeatSize));
    const dist = distributeReferencesSnake(combined, rpHeatCount, rpHeatSize);

    const rpRound: RoundSpec = {
      name: `Repechage R${repechage.length + 1}`,
      roundNumber: repechage.length + 1,
      heats: dist.map((refs, idx) => {
        const colorSet = getColorSet(rpHeatSize);
        return {
          heatNumber: idx + 1,
          slots: refs.map((ref, slotIdx) => {
            if (ref.sourceRound === 101) {
              return {
                placeholder: makePlaceholder({ sourceRound: 900, heatNumber: ref.heatNumber, position: ref.position }, 'RP'),
                color: colorSet[slotIdx],
              };
            }
            if (ref.sourceRound === 0) {
              return { bye: true, placeholder: 'BYE', color: colorSet[slotIdx] };
            }
            return { placeholder: makePlaceholder(ref), color: colorSet[slotIdx] };
          }),
          roundRef: `RP${repechage.length + 1}-H${idx + 1}`,
        };
      }),
    };

    repechage.push(rpRound);
    previousRefs = rpRound.heats.flatMap((heat) => heat.slots.map((_, slotIdx) => ({
      sourceRound: 100 + repechage.length,
      heatNumber: heat.heatNumber,
      position: slotIdx + 1,
    })));
  });

  return repechage;
}

export function computeHeats(participants: ParticipantSeed[], options: ComputeOptions): ComputeResult {
  const { preferredHeatSize = 'auto', variant = 'V1' } = options;
  const participantCount = participants.length;
  const heatSize = determineHeatSize(participantCount, preferredHeatSize);
  const heatCount = determineHeatCount(participantCount, heatSize);
  const baseSize = heatCount > 0 ? Math.floor(participantCount / heatCount) : participantCount;
  const remainder = heatCount > 0 ? participantCount % heatCount : 0;
  const variableHeatSizes =
    heatCount > 0
      ? Array.from({ length: heatCount }, (_, idx) => {
        const sizeCandidate = baseSize + (idx < remainder ? 1 : 0);
        if (sizeCandidate <= 0) {
          return heatSize;
        }
        return Math.min(heatSize, sizeCandidate);
      })
      : [];

  const seedMap = distributeSeedsSnake(
    participants.map((p) => p.seed),
    {
      heatSize,
      heatCount,
      heatSizes: variableHeatSizes,
    }
  );

  const round1Heats = toHeatSlots(seedMap, participants);
  const mainRounds = [
    {
      name: 'Round 1',
      roundNumber: 1,
      heats: round1Heats,
    } satisfies RoundSpec,
  ];

  if (options.format === 'single-elim') {
    const nextRounds = buildSingleElimNextRounds(round1Heats, variant);
    mainRounds.push(...nextRounds);
    return { rounds: mainRounds };
  }

  const nextRounds = buildSingleElimNextRounds(round1Heats, variant);
  const repechageRounds = buildRepechageFlows(round1Heats, nextRounds);
  return { rounds: [...mainRounds, ...nextRounds], repechage: repechageRounds };
}
