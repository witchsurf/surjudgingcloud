import { Heat } from '../types';
import { SURFER_COLORS } from './constants';

type HeatPlan = { round: number; heats: Heat[] };

const colorKeys = Object.keys(SURFER_COLORS);
const fallbackColors = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'];
const colorPalette = colorKeys.length ? colorKeys : fallbackColors;

const pickColor = (index: number) => colorPalette[index % colorPalette.length];

const normaliseParticipant = (participant: any, colorIndex: number) => ({
  color: pickColor(colorIndex),
  name: participant?.name ?? `Surfeur ${colorIndex + 1}`,
  country: participant?.country ?? ''
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

type QualifierRef = { round: number; heatNumber: number; position: number };

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

  let bucketIndex = 0;
  let direction: 1 | -1 = 1;

  const advanceIndex = () => {
    if (sizes.length <= 1) return;
    bucketIndex += direction;
    if (bucketIndex >= sizes.length) {
      bucketIndex = sizes.length - 1;
      direction = -1;
    } else if (bucketIndex < 0) {
      bucketIndex = 0;
      direction = 1;
    }
  };

  refs.forEach((ref) => {
    let attempts = 0;
    while (capacities[bucketIndex] === 0 && attempts < sizes.length) {
      advanceIndex();
      attempts += 1;
    }

    buckets[bucketIndex].push(ref);
    capacities[bucketIndex] = Math.max(0, capacities[bucketIndex] - 1);
    advanceIndex();
  });

  return buckets
    .map((bucket, heatIdx) => {
      if (!bucket.length) return null;
      const slots = bucket.map((ref, slotIdx) =>
        placeholderFrom(ref.round, ref.heatNumber, slotIdx, label, ref.position)
      );
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

const buildManOnManBracket = (participants: any[]): HeatPlan[] => {
  const total = participants.length;
  const heats: HeatPlan[] = [];

  if (total >= 6) {
    const round1: Heat[] = [];
    let heatNo = 1;
    for (let i = 0; i < total; i += 2) {
      const surfers = [normaliseParticipant(participants[i], 0)];
      if (participants[i + 1]) {
        surfers.push(normaliseParticipant(participants[i + 1], 1));
      }
      if (surfers.length === 2) {
        round1.push(createHeat(1, heatNo++, surfers));
      }
    }
    heats.push({ round: 1, heats: round1 });

    heats.push({
      round: 2,
      heats: [
        createHeat(2, 1, [
          placeholderFrom(1, 1, 0, 'Vainqueur'),
          placeholderFrom(1, 2, 1, 'Vainqueur')
        ]),
        createHeat(2, 2, [
          placeholderFrom(1, 3, 0, 'Vainqueur'),
          placeholderFrom(1, 4, 1, 'Vainqueur')
        ])
      ]
    });

    heats.push({
      round: 3,
      heats: [
        createHeat(3, 1, [
          placeholderFrom(2, 1, 0, 'Vainqueur'),
          placeholderFrom(2, 2, 1, 'Vainqueur')
        ])
      ]
    });
    return heats;
  }

  if (total === 4) {
    const round1: Heat[] = [];
    let heatNo = 1;
    for (let i = 0; i < total; i += 2) {
      const surfers = [normaliseParticipant(participants[i], 0)];
      if (participants[i + 1]) {
        surfers.push(normaliseParticipant(participants[i + 1], 1));
      }
      round1.push(createHeat(1, heatNo++, surfers));
    }
    heats.push({ round: 1, heats: round1 });
    heats.push({
      round: 2,
      heats: [
        createHeat(2, 1, [
          placeholderFrom(1, 1, 0, 'Vainqueur'),
          placeholderFrom(1, 2, 1, 'Vainqueur')
        ])
      ]
    });
    return heats;
  }

  const round1: Heat[] = [];
  let heatNo = 1;
  for (let i = 0; i < total; i += 2) {
    const surfers = [normaliseParticipant(participants[i], 0)];
    if (participants[i + 1]) {
      surfers.push(normaliseParticipant(participants[i + 1], 1));
    }
    round1.push(createHeat(1, heatNo++, surfers));
  }
  heats.push({ round: 1, heats: round1 });
  return heats;
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
    placeholderFrom(1, 2, 0, 'Qualifié'),
    placeholderFrom(1, 2, 1, 'Qualifié')
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
    placeholderFrom(1, 2, 0, 'Qualifié'),
    placeholderFrom(1, 2, 1, 'Qualifié')
  ]);

  return [
    { round: 1, heats: round1 },
    { round: 2, heats: [final] }
  ];
};

export const generatePreviewHeats = (
  participants: any[],
  format: 'elimination' | 'repechage',
  seriesSize: number
): HeatPlan[] => {
  const totalParticipants = participants.length;

  if (seriesSize === 2) {
    return buildManOnManBracket(participants);
  }

  if (totalParticipants === 6 && seriesSize >= 3) {
    return buildSixPersonBracket(participants);
  }

  if (totalParticipants === 8 && seriesSize >= 4) {
    return buildEightPersonBracket(participants);
  }

  if (totalParticipants === 0) {
    return [];
  }

  const rounds: HeatPlan[] = [];
  const round1Heats: Heat[] = [];

  const round1Sizes = distributeHeatSizes(totalParticipants, seriesSize);
  let participantIndex = 0;
  round1Sizes.forEach((targetSize) => {
    const surfers: Array<{ color: string; name: string; country: string }> = [];
    for (let slotIdx = 0; slotIdx < targetSize; slotIdx += 1) {
      const participant = participants[participantIndex];
      if (!participant) break;
      surfers.push(normaliseParticipant(participant, slotIdx));
      participantIndex += 1;
    }
    if (surfers.length) {
      round1Heats.push(createHeat(1, round1Heats.length + 1, surfers));
    }
  });

  if (!round1Heats.length) {
    return [];
  }

  rounds.push({ round: 1, heats: round1Heats });

  let { adv: mainRefs, rep: repechageRefs } = buildQualifierBuckets(1, round1Heats);
  let currentRound = 2;
  const finalMainSlots =
    format === 'repechage' ? Math.max(2, Math.floor(seriesSize / 2)) : seriesSize;
  const finalRepSlots = format === 'repechage' ? Math.max(2, seriesSize - finalMainSlots) : 0;

  const runMainRound = () => {
    if (mainRefs.length <= finalMainSlots) {
      return false;
    }
    const mainHeats = buildHeatsFromRefs(mainRefs, currentRound, 'Qualifié', seriesSize);
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
    const mainFinalists = mainRefs.slice(0, Math.min(finalMainSlots, mainRefs.length));
    let finalSlots = mainFinalists.map((ref, idx) =>
      placeholderFrom(ref.round, ref.heatNumber, idx, 'Finaliste', ref.position)
    );

    if (format === 'repechage') {
      const repFinalists = repechageRefs.slice(0, Math.min(finalRepSlots, repechageRefs.length));
      const repSlots = repFinalists.map((ref, idx) =>
        placeholderFrom(ref.round, ref.heatNumber, finalSlots.length + idx, 'Repêchage', ref.position)
      );
      finalSlots = finalSlots.concat(repSlots);

      if (finalSlots.length < seriesSize && mainRefs.length > mainFinalists.length) {
        const extra = mainRefs
          .slice(mainFinalists.length, Math.min(seriesSize, mainRefs.length))
          .map((ref, idx) =>
            placeholderFrom(ref.round, ref.heatNumber, finalSlots.length + idx, 'Finaliste', ref.position)
          );
        finalSlots = finalSlots.concat(extra);
      }
    }

    finalSlots = finalSlots.slice(0, Math.min(seriesSize, finalSlots.length));

    if (finalSlots.length) {
      rounds.push({
        round: currentRound,
        heats: [createHeat(currentRound, 1, finalSlots)]
      });
    }
  }

  return rounds;
};
