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

const placeholderFrom = (round: number, heatNumber: number, colorIndex: number, label: string) => ({
  color: pickColor(colorIndex),
  name: `${label} R${round}-H${heatNumber}`,
  country: ''
});

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
  const colors = [0, 1, 2];
  const round1: Heat[] = [];
  let heatNo = 1;
  for (let i = 0; i < participants.length; i += 3) {
    const surfers = colors
      .map((colorIndex, idx) => participants[i + idx])
      .filter(Boolean)
      .map((participant, idx) => normaliseParticipant(participant, colors[idx]));
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

  const rounds: HeatPlan[] = [];
  const round1Heats: Heat[] = [];
  let currentHeat: { surfers: any[] } = { surfers: [] };

  participants.forEach(participant => {
    if (currentHeat.surfers.length >= seriesSize) {
      round1Heats.push(createHeat(1, round1Heats.length + 1, currentHeat.surfers));
      currentHeat = { surfers: [] };
    }
    currentHeat.surfers.push(normaliseParticipant(participant, currentHeat.surfers.length));
  });

  if (currentHeat.surfers.length > 0) {
    round1Heats.push(createHeat(1, round1Heats.length + 1, currentHeat.surfers));
  }

  rounds.push({ round: 1, heats: round1Heats });

  let currentRound = 2;
  let previousRoundSurfers = Math.ceil(totalParticipants / seriesSize) * 2;

  while (previousRoundSurfers > seriesSize) {
    const roundHeats: Heat[] = [];
    const numHeats = Math.ceil(previousRoundSurfers / seriesSize);

    for (let i = 0; i < numHeats; i++) {
      roundHeats.push(
        createHeat(
          currentRound,
          i + 1,
          Array(Math.min(seriesSize, previousRoundSurfers - i * seriesSize))
            .fill(null)
            .map((_, idx) => placeholderFrom(currentRound - 1, Math.floor(i / 2) + 1, idx, 'Qualifié'))
        )
      );
    }

    rounds.push({ round: currentRound, heats: roundHeats });
    previousRoundSurfers = numHeats * 2;
    currentRound++;
  }

  rounds.push({
    round: currentRound,
    heats: [
      createHeat(
        currentRound,
        1,
        Array(seriesSize)
          .fill(null)
          .map((_, idx) =>
            placeholderFrom(currentRound - 1, Math.ceil((idx + 1) / 2), idx, 'Finaliste')
          )
      )
    ]
  });

  return rounds;
};
