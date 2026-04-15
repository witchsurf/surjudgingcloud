import { Heat } from '../types';
import { distributeSeedsSnake } from './seeding';

type HeatPlan = { round: number; heats: Heat[] };
export interface GeneratePreviewOptions {
  manOnManFromRound?: number;
  promoteBestSecond?: boolean;
}

export interface ManOnManRoundOption {
  round: number;
  requiresBestSecond: boolean;
  wildcardSourceRound?: number;
  warning?: string;
}

// Palette de couleurs fixe pour garantir l'ordre standard quoi qu'il arrive
const FIXED_COLOR_PALETTE = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'];

const pickColor = (index: number) => FIXED_COLOR_PALETTE[index % FIXED_COLOR_PALETTE.length];

const normaliseParticipant = (participant: any, colorIndex: number) => ({
  color: pickColor(colorIndex),
  name: participant?.name ?? `Surfeur ${colorIndex + 1}`,
  country: participant?.country ?? '',
  seed: participant?.seed ?? null
});

const createHeat = (
  round: number,
  heatNumber: number,
  surfers: Array<{ color: string; name: string; country: string }>
): Heat => ({
  round,
  heat_number: heatNumber,
  surfers
});

const placeholderFrom = (
  round: number,
  heatNumber: number,
  colorIndex: number,
  label: string,
  position?: number
) => ({
  color: pickColor(colorIndex),
  name: `${label} R${round}-H${heatNumber}${position ? ` (P${position})` : ''}`,
  country: ''
});

const getAdvancingCount = (heatSize: number) => Math.max(1, Math.ceil(heatSize / 2));

type QualifierRef = {
  round: number;
  heatNumber: number;
  position: number;
  customName?: string;
};

const buildQualifierBuckets = (roundNumber: number, heats: Heat[]) => {
  const adv: QualifierRef[] = [];
  const rep: QualifierRef[] = [];

  heats.forEach((heat) => {
    const advancing = getAdvancingCount(heat.surfers.length);
    heat.surfers.forEach((_, idx) => {
      const ref: QualifierRef = {
        round: roundNumber,
        heatNumber: heat.heat_number,
        position: idx + 1
      };
      if (idx < advancing) {
        adv.push(ref);
      } else {
        rep.push(ref);
      }
    });
  });

  return { adv, rep };
};

const buildHeatsFromRefs = (
  refs: QualifierRef[],
  roundNumber: number,
  label: string,
  seriesSize: number
): Heat[] => {
  if (!refs.length) return [];
  const sizes = distributeHeatSizes(refs.length, seriesSize);
  const capacities = sizes.slice();
  const buckets: QualifierRef[][] = sizes.map(() => []);

  // Sort refs by Position first (P1s, then P2s, then P3s...), then by Heat.
  // This "Layered" distribution ensures we spread the top seeds widely before placing lower seeds,
  // preventing early heats from filling up with pairs from the same source.
  const sortedRefs = [...refs].sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.heatNumber - b.heatNumber;
  });

  const positionOffsets: Record<number, number> = {};

  sortedRefs.forEach((ref) => {
    // Strategy: Greedy Load Balancing with Collision Avoidance.
    // 1. Identify all buckets with Capacity > 0.
    // 2. Filter out buckets that already contain a surfer from the same Source Heat (Collision).
    // 3. Sort candidates by Remaining Capacity (Descending).
    //    Using the bucket with MOST space preserves options for later surfers in smaller buckets.
    // 4. Tie-breaking: Random or Sequential? Sequential (index) to keep it stable.

    // Helper to check collision
    const checkCollision = (bIndex: number) => {
      return buckets[bIndex].some(r => r.round === ref.round && r.heatNumber === ref.heatNumber);
    };

    const candidates = sizes.map((_, idx) => idx).filter(idx => capacities[idx] > 0);

    // Filter non-colliding
    const safeCandidates = candidates.filter(idx => !checkCollision(idx));

    // If we have safe options, use them. Otherwise fallback to any open bucket (forced collision).
    const finalCandidates = safeCandidates.length > 0 ? safeCandidates : candidates;

    if (finalCandidates.length === 0) {
      console.warn("No space left for ref:", ref);
      return;
    }

    const p = ref.position;
    if (positionOffsets[p] === undefined) {
      positionOffsets[p] = 0;
    }

    // Shift target bucket to cross-seed positions (e.g. P1s start at 0, P2s start at 1, etc.)
    const targetOffset = (p - 1) % sizes.length;
    const targetBucket = (positionOffsets[p] + targetOffset) % sizes.length;
    positionOffsets[p]++;

    // Sort by Capacity Descending (primary), then distance to target bucket
    finalCandidates.sort((a, b) => {
      if (capacities[b] !== capacities[a]) {
        return capacities[b] - capacities[a];
      }
      const distA = (a - targetBucket + sizes.length) % sizes.length;
      const distB = (b - targetBucket + sizes.length) % sizes.length;
      return distA - distB;
    });

    const chosenIndex = finalCandidates[0];

    buckets[chosenIndex].push(ref);
    capacities[chosenIndex] = Math.max(0, capacities[chosenIndex] - 1);
  });

  return buckets
    .map((bucket, heatIdx) => {
      if (!bucket.length) return null;
      // IMPORTANT: Color index must be the surfer's position WITHIN this heat (0=ROUGE,1=BLANC,2=JAUNE,3=BLEU)
      // NOT the bucket's internal slot index, which can cause duplicates
      const slots = bucket.map((ref, surferIdx) => (
        ref.customName
          ? {
            color: pickColor(surferIdx),
            name: ref.customName,
            country: ''
          }
          : placeholderFrom(ref.round, ref.heatNumber, surferIdx, label, ref.position)
      ));
      return createHeat(roundNumber, heatIdx + 1, slots);
    })
    .filter((heat): heat is Heat => Boolean(heat));
};

const distributeHeatSizes = (totalSurfers: number, heatSize: number): number[] => {
  if (totalSurfers <= 0) return [];
  const heatCount = Math.max(1, Math.ceil(totalSurfers / heatSize));
  const baseSize = Math.floor(totalSurfers / heatCount);
  const remainder = totalSurfers % heatCount;
  return Array.from({ length: heatCount }, (_, idx) => baseSize + (idx < remainder ? 1 : 0));
};

const buildManOnManBracket = (participants: any[], promoteBestSecond = false): HeatPlan[] => {
  const total = participants.length;
  if (total <= 0) return [];

  const bracket: HeatPlan[] = [];
  const round1: Heat[] = [];

  for (let i = 0, heatNo = 1; i < total; i += 2, heatNo += 1) {
    const surfers = [normaliseParticipant(participants[i], 0)];
    if (participants[i + 1]) {
      surfers.push(normaliseParticipant(participants[i + 1], 1));
    }
    round1.push(createHeat(1, heatNo, surfers));
  }

  bracket.push({ round: 1, heats: round1 });

  let previousRound = 1;
  let previousHeatCount = round1.length;
  let bestSecondUsed = false;

  while (previousHeatCount > 1) {
    const currentRound = previousRound + 1;
    const refs: QualifierRef[] = Array.from({ length: previousHeatCount }, (_, index) => ({
      round: previousRound,
      heatNumber: index + 1,
      position: 1
    }));

    if (promoteBestSecond && !bestSecondUsed && previousHeatCount % 2 === 1) {
      refs.push({
        round: previousRound,
        heatNumber: 0,
        position: 2,
        customName: `Meilleur 2e R${previousRound}`
      });
      bestSecondUsed = true;
    }

    const heats = buildHeatsFromRefs(refs, currentRound, 'Vainqueur', 2);

    bracket.push({ round: currentRound, heats });
    previousRound = currentRound;
    previousHeatCount = heats.length;
  }

  return bracket;
};

const buildSixPersonBracket = (participants: any[]): HeatPlan[] => {
  const round1: Heat[] = [];
  let heatNo = 1;
  for (let i = 0; i < participants.length; i += 3) {
    const surfers = Array.from({ length: 3 }, (_, idx) => participants[i + idx])
      .filter(Boolean)
      .map((participant, idx) => normaliseParticipant(participant, idx));
    round1.push(createHeat(1, heatNo++, surfers));
  }

  const final = createHeat(2, 1, [
    placeholderFrom(1, 1, 0, 'Qualifié'),
    placeholderFrom(1, 1, 1, 'Qualifié'),
    placeholderFrom(1, 2, 2, 'Qualifié'),
    placeholderFrom(1, 2, 3, 'Qualifié')
  ]);

  return [
    { round: 1, heats: round1 },
    { round: 2, heats: [final] }
  ];
};

const buildEightPersonBracket = (participants: any[]): HeatPlan[] => {
  const round1: Heat[] = [];
  let heatNo = 1;
  for (let i = 0; i < participants.length; i += 4) {
    const surfers = Array(4)
      .fill(null)
      .map((_, idx) => participants[i + idx])
      .filter(Boolean)
      .map((participant, idx) => normaliseParticipant(participant, idx));
    round1.push(createHeat(1, heatNo++, surfers));
  }

  const final = createHeat(2, 1, [
    placeholderFrom(1, 1, 0, 'Qualifié'),
    placeholderFrom(1, 1, 1, 'Qualifié'),
    placeholderFrom(1, 2, 2, 'Qualifié'),
    placeholderFrom(1, 2, 3, 'Qualifié')
  ]);

  return [
    { round: 1, heats: round1 },
    { round: 2, heats: [final] }
  ];
};

export const generatePreviewHeats = (
  participants: any[],
  format: 'elimination' | 'repechage',
  seriesSize: number,
  options?: GeneratePreviewOptions
): HeatPlan[] => {
  const manOnManFromRound = options?.manOnManFromRound ?? 0; // 0 = disabled
  const totalParticipants = participants.length;

  // Prepare for Snake Seeding (Universal)
  // Map seeds (or fallback to index) to participants found in order
  const seedToParticipant = new Map<number, any>();
  const seeds: number[] = [];

  participants.forEach((p, idx) => {
    // If input is sorted by rank/seed, we can trust the index as the "seed for distribution"
    // Use explicit seed if available and unique, otherwise use index+1
    const seedVal = (typeof p.seed === 'number' && p.seed > 0 && !seedToParticipant.has(p.seed))
      ? p.seed
      : idx + 1;

    seeds.push(seedVal);
    seedToParticipant.set(seedVal, p);
  });

  const shouldStartManOnMan = seriesSize === 2 || manOnManFromRound === 1;

  if (shouldStartManOnMan) {
    const manOnManSizes = distributeHeatSizes(totalParticipants, 2);
    const manOnManSeedMap = distributeSeedsSnake(seeds, {
      heatSize: 2,
      heatCount: manOnManSizes.length,
      heatSizes: manOnManSizes
    });
    const participantsInManOnManOrder: any[] = [];

    [...manOnManSeedMap]
      .sort((a, b) => a.heatNumber - b.heatNumber)
      .forEach((heat) => {
        heat.seeds.forEach((seed: number | null) => {
          if (seed !== null) {
            participantsInManOnManOrder.push(seedToParticipant.get(seed));
          }
        });
      });

    return buildManOnManBracket(participantsInManOnManOrder, options?.promoteBestSecond);
  }

  // Calculate Standard Round 1 Heat Sizes
  const round1Sizes = distributeHeatSizes(totalParticipants, seriesSize);

  // Distribute using Snake Logic
  const seedMap = distributeSeedsSnake(seeds, {
    heatSize: seriesSize,
    heatCount: round1Sizes.length,
    heatSizes: round1Sizes
  });

  // Re-construct the "participants" array in Heat-Order (H1 Surfers, then H2 Surfers...)
  // This allows the "Sequential" builders (buildSix, buildEight) to naturally produce Snake heats
  // because they take the first N items for H1, next N for H2, etc.

  const participantsInHeatOrder: any[] = [];

  // seedMap is an array of { heatNumber, seeds[] }
  // Sort by heatNumber just to be safe (though usually sorted)
  const sortedHeats = [...seedMap].sort((a, b) => a.heatNumber - b.heatNumber);

  sortedHeats.forEach((hm) => {
    hm.seeds.forEach((seed: number | null) => {
      if (seed !== null) {
        participantsInHeatOrder.push(seedToParticipant.get(seed));
      }
    });
  });

  if (totalParticipants === 6 && seriesSize >= 3) {
    return buildSixPersonBracket(participantsInHeatOrder);
  }

  // New rule for 5 participants
  if (totalParticipants === 5 && seriesSize >= 3) {
    const final = createHeat(1, 1, participants.map((p, i) => normaliseParticipant(p, i)));
    return [{ round: 1, heats: [final] }];
  }

  if (totalParticipants === 8 && seriesSize >= 4) {
    return buildEightPersonBracket(participantsInHeatOrder);
  }

  const rounds: HeatPlan[] = [];
  const round1Heats: Heat[] = [];

  // General Logic: now we can just use the seedMap we already calculated!
  seedMap.forEach((hm) => {
    const surfers: Array<{ color: string; name: string; country: string }> = [];

    hm.seeds.forEach((seed, slotIdx) => {
      if (seed === null) return; // Empty slot (Bye)

      const p = seedToParticipant.get(seed);
      if (p) {
        surfers.push(normaliseParticipant(p, slotIdx));
      } else {
        surfers.push({
          color: pickColor(slotIdx),
          name: `Semence ${seed}`,
          country: ''
        });
      }
    });

    // Only add heat if it has surfers (or byes only? no, normally has seeds)
    if (surfers.length) {
      round1Heats.push(createHeat(1, hm.heatNumber, surfers));
    }
  });

  if (!round1Heats.length) {
    return [];
  }

  rounds.push({ round: 1, heats: round1Heats });

  let { adv: mainRefs, rep: repechageRefs } = buildQualifierBuckets(1, round1Heats);
  let currentRound = 2;
  let bestSecondUsed = false;
  const finalMainSlots =
    format === 'repechage' ? Math.max(2, Math.floor(seriesSize / 2)) : seriesSize;
  const finalRepSlots = format === 'repechage' ? Math.max(2, seriesSize - finalMainSlots) : 0;

  const maybePromoteBestSecond = (refs: QualifierRef[], roundNumber: number, finalSlotThreshold: number) => {
    if (
      bestSecondUsed ||
      !options?.promoteBestSecond ||
      manOnManFromRound <= 0 ||
      roundNumber < manOnManFromRound
    ) {
      return refs;
    }
    if (refs.length <= finalSlotThreshold || refs.length % 2 === 0) {
      return refs;
    }

    bestSecondUsed = true;
    return refs.concat({
      round: roundNumber - 1,
      heatNumber: 0,
      position: 2,
      customName: `Meilleur 2e R${roundNumber - 1}`
    });
  };

  const runMainRound = () => {
    // Determine effective series size for this round (hybrid format support)
    const effectiveSize = (manOnManFromRound > 0 && currentRound >= manOnManFromRound) ? 2 : seriesSize;
    const effectiveFinalSlots = (manOnManFromRound > 0 && currentRound >= manOnManFromRound) ? 2 : finalMainSlots;

    mainRefs = maybePromoteBestSecond(mainRefs, currentRound, effectiveFinalSlots);

    if (mainRefs.length <= effectiveFinalSlots) {
      return false;
    }
    const mainHeats = buildHeatsFromRefs(mainRefs, currentRound, 'Qualifié', effectiveSize);
    if (!mainHeats.length) {
      mainRefs = [];
      return false;
    }
    rounds.push({ round: currentRound, heats: mainHeats });
    const buckets = buildQualifierBuckets(currentRound, mainHeats);
    mainRefs = buckets.adv;
    if (format === 'repechage') {
      repechageRefs = repechageRefs.concat(buckets.rep);
    }
    currentRound += 1;
    return true;
  };

  const runRepechageRound = () => {
    if (format !== 'repechage' || repechageRefs.length <= finalRepSlots) {
      return false;
    }
    const repHeats = buildHeatsFromRefs(repechageRefs, currentRound, 'Repêchage', seriesSize);
    if (!repHeats.length) {
      repechageRefs = [];
      return false;
    }
    rounds.push({ round: currentRound, heats: repHeats });
    const repBuckets = buildQualifierBuckets(currentRound, repHeats);
    repechageRefs = repBuckets.adv;
    currentRound += 1;
    return true;
  };

  while (runMainRound()) {
    while (runRepechageRound()) {
      // Continue repechage rounds until stabilized for this stage
    }
  }
  while (runRepechageRound()) {
    // Finish repechage bracket if main bracket already narrowed down
  }

  const shouldCreateFinal =
    (mainRefs.length > 0 || (format === 'repechage' && repechageRefs.length > 0)) &&
    (round1Heats.length > 1 || rounds.length > 1);

  if (shouldCreateFinal) {
    // Determine final heat size (man-on-man finals if configured)
    const finalEffectiveSize = (manOnManFromRound > 0 && currentRound >= manOnManFromRound) ? 2 : seriesSize;
    const effectiveFinalMainSlots = (manOnManFromRound > 0 && currentRound >= manOnManFromRound)
      ? Math.min(2, mainRefs.length)
      : finalMainSlots;

    const mainFinalists = mainRefs.slice(0, Math.min(effectiveFinalMainSlots, mainRefs.length));
    // Color index = position within the final heat (0=ROUGE,1=BLANC,2=JAUNE,3=BLEU)
    let finalSlots = mainFinalists.map((ref, idx) =>
      placeholderFrom(ref.round, ref.heatNumber, idx, 'Finaliste', ref.position)
    );

    if (format === 'repechage') {
      const effectiveFinalRepSlots = (manOnManFromRound > 0 && currentRound >= manOnManFromRound)
        ? Math.max(0, 2 - mainFinalists.length)
        : finalRepSlots;
      const repFinalists = repechageRefs.slice(0, Math.min(effectiveFinalRepSlots, repechageRefs.length));
      const repSlots = repFinalists.map((ref, idx) =>
        placeholderFrom(ref.round, ref.heatNumber, finalSlots.length + idx, 'Repêchage', ref.position)
      );
      finalSlots = finalSlots.concat(repSlots);

      if (finalSlots.length < finalEffectiveSize && mainRefs.length > mainFinalists.length) {
        const extra = mainRefs
          .slice(mainFinalists.length, Math.min(finalEffectiveSize, mainRefs.length))
          .map((ref, idx) =>
            placeholderFrom(ref.round, ref.heatNumber, finalSlots.length + idx, 'Finaliste', ref.position)
          );
        finalSlots = finalSlots.concat(extra);
      }
    }

    finalSlots = finalSlots.slice(0, Math.min(finalEffectiveSize, finalSlots.length));

    if (finalSlots.length) {
      rounds.push({
        round: currentRound,
        heats: [createHeat(currentRound, 1, finalSlots)]
      });
    }
  }

  return rounds;
};

const serializePlan = (rounds: HeatPlan[]) =>
  rounds
    .map((round) => `${round.round}:${round.heats.map((heat) => heat.surfers.length).join(',')}`)
    .join('|');

const findFirstSoloHeatRound = (rounds: HeatPlan[], startRound: number) =>
  rounds.find((round) => round.round >= startRound && round.heats.some((heat) => heat.surfers.length < 2))?.round;

export const getManOnManRoundOptions = (
  participants: any[],
  format: 'elimination' | 'repechage',
  seriesSize: number
): ManOnManRoundOption[] => {
  if (seriesSize <= 2 || participants.length <= 2) {
    return [];
  }

  const classicRounds = generatePreviewHeats(participants, format, seriesSize);
  const classicSignature = serializePlan(classicRounds);
  const maxCandidateRound = classicRounds.length;
  const candidateRounds = [
    ...(participants.length >= 4 && participants.length % 2 === 0 ? [1] : []),
    ...Array.from({ length: Math.max(0, maxCandidateRound - 1) }, (_, index) => index + 2)
  ];

  return candidateRounds
    .map((round) => {
      const generated = generatePreviewHeats(participants, format, seriesSize, {
        manOnManFromRound: round
      });

      if (serializePlan(generated) === classicSignature) {
        return null;
      }

      const firstSoloRound = findFirstSoloHeatRound(generated, round);
      if (!firstSoloRound) {
        return {
          round,
          requiresBestSecond: false
        };
      }

      const resolved = generatePreviewHeats(participants, format, seriesSize, {
        manOnManFromRound: round,
        promoteBestSecond: true
      });
      const resolvedSoloRound = findFirstSoloHeatRound(resolved, round);

      if (resolvedSoloRound) {
        return null;
      }

      const wildcardSourceRound = firstSoloRound - 1;

      return {
        round,
        requiresBestSecond: true,
        wildcardSourceRound,
        warning: `Le man-on-man au Round ${round} laisserait un heat à 1 surfeur au Round ${firstSoloRound}. Ajoutez le meilleur 2e du Round ${wildcardSourceRound} pour équilibrer le tableau.`
      };
    })
    .filter((option): option is ManOnManRoundOption => Boolean(option));
};
