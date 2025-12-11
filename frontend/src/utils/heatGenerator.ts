type ParticipantInput = {
  seed: number;
  name: string;
  participantId?: number;
};

type RepechageConfig = {
  enabled: boolean;
  advMainPerHeat: number;
  toRepPerHeat: number;
  advRepPerHeat: number;
};

export interface HeatGeneratorInput {
  eventName: string;
  division: string;
  eventId?: number;
  surfers: ParticipantInput[];
  heatSize: number;
  repechage?: RepechageConfig;
}

export interface HeatRow {
  id: string;
  event_id: number;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  heat_size: number;
  status: 'waiting';
  color_order: string[];
}

export interface HeatEntryRow {
  heat_id: string;
  participant_id: number | null;
  position: number;
  seed: number;
  color: string | null;
}

export interface HeatSlotMappingRow {
  heat_id: string;
  position: number;
  placeholder: string | null;
  source_round: number | null;
  source_heat: number | null;
  source_position: number | null;
}

interface SlotDescriptor {
  participant?: ParticipantInput;
  placeholder?: string;
  sourceRound?: number;
  sourceHeat?: number;
  sourcePosition?: number;
}

interface PlannedHeat {
  round: number;
  heatNumber: number;
  slots: SlotDescriptor[];
}

const BASE_COLORS = ['RED', 'WHITE', 'YELLOW', 'BLUE', 'GREEN', 'BLACK'];

const getColorSet = (size: number) =>
  BASE_COLORS.slice(0, Math.max(1, Math.min(size, BASE_COLORS.length)));

const normaliseString = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const makeHeatId = (event: string, division: string, round: number, heat: number) =>
  `${normaliseString(event)}_${normaliseString(division)}_R${round}_H${heat}`;

const ensureSeedsContinuity = (surfers: ParticipantInput[]) => {
  const sorted = [...surfers].sort((a, b) => a.seed - b.seed);
  for (let i = 0; i < sorted.length; i++) {
    const expectedSeed = i + 1;
    if (sorted[i].seed !== expectedSeed) {
      throw new Error(`Missing participant for seed ${expectedSeed}`);
    }
  }
  return sorted;
};

const placeholderLabel = (prefix: string, round: number, heat: number, position: number) =>
  `${prefix} R${round}-H${heat} P${position}`;

const chunkSlots = (slots: SlotDescriptor[], heatSize: number): SlotDescriptor[][] => {
  const result: SlotDescriptor[][] = [];
  let buffer: SlotDescriptor[] = [];
  slots.forEach(slot => {
    buffer.push(slot);
    if (buffer.length === heatSize) {
      result.push(buffer);
      buffer = [];
    }
  });
  if (buffer.length > 0) {
    result.push(buffer);
  }
  return result;
};

const buildManOnMan = (participants: ParticipantInput[]): PlannedHeat[] => {
  const rounds: PlannedHeat[] = [];
  const total = participants.length;
  const heatsRound1: PlannedHeat[] = [];
  let heatNumber = 1;

  for (let i = 0; i < total; i += 2) {
    const pair = [participants[i], participants[i + 1]].filter(Boolean);
    if (pair.length === 0) continue;
    heatsRound1.push({
      round: 1,
      heatNumber: heatNumber++,
      slots: pair.map((participant, index) => ({
        participant,
        sourceRound: null,
        sourceHeat: null,
        sourcePosition: index + 1
      }))
    });
  }

  if (heatsRound1.length === 0) return rounds;

  rounds.push(...heatsRound1);

  if (total >= 8) {
    const semiFinals: PlannedHeat[] = [];
    for (let i = 0; i < heatsRound1.length; i += 2) {
      const heatA = i + 1;
      const heatB = i + 2;
      if (heatB <= heatsRound1.length) {
        semiFinals.push({
          round: 2,
          heatNumber: semiFinals.length + 1,
          slots: [
            {
              placeholder: placeholderLabel('Vainqueur', 1, heatA, 1),
              sourceRound: 1,
              sourceHeat: heatA,
              sourcePosition: 1
            },
            {
              placeholder: placeholderLabel('Vainqueur', 1, heatB, 1),
              sourceRound: 1,
              sourceHeat: heatB,
              sourcePosition: 1
            }
          ]
        });
      }
    }
    rounds.push(...semiFinals);

    const finalSlots: SlotDescriptor[] = semiFinals.map((_, idx) => ({
      placeholder: placeholderLabel('Vainqueur', 2, idx + 1, 1),
      sourceRound: 2,
      sourceHeat: idx + 1,
      sourcePosition: 1
    }));

    if (finalSlots.length > 0) {
      rounds.push({
        round: 3,
        heatNumber: 1,
        slots: finalSlots
      });
    }
  } else if (total === 6) {
    const finalSlots: SlotDescriptor[] = heatsRound1.map((_, idx) => ({
      placeholder: placeholderLabel('Vainqueur', 1, idx + 1, 1),
      sourceRound: 1,
      sourceHeat: idx + 1,
      sourcePosition: 1
    }));

    rounds.push({
      round: 2,
      heatNumber: 1,
      slots: finalSlots.slice(0, 3)
    });
  } else if (total >= 4) {
    rounds.push({
      round: 2,
      heatNumber: 1,
      slots: [
        {
          placeholder: placeholderLabel('Vainqueur', 1, 1, 1),
          sourceRound: 1,
          sourceHeat: 1,
          sourcePosition: 1
        },
        {
          placeholder: placeholderLabel('Vainqueur', 1, 2, 1),
          sourceRound: 1,
          sourceHeat: 2,
          sourcePosition: 1
        }
      ]
    });
  }

  return rounds;
};

const buildSixPerson = (participants: ParticipantInput[], heatSize: number): PlannedHeat[] => {
  if (heatSize === 6) {
    return [
      {
        round: 1,
        heatNumber: 1,
        slots: participants.map((participant, index) => ({
          participant,
          sourceRound: null,
          sourceHeat: null,
          sourcePosition: index + 1
        }))
      }
    ];
  }

  const colors = [0, 1, 2];
  const heats: PlannedHeat[] = [];
  let cursor = 0;
  for (let h = 1; h <= 2; h++) {
    const slots: SlotDescriptor[] = [];
    colors.forEach(colorIndex => {
      const participant = participants[cursor++];
      if (participant) {
        slots.push({
          participant,
          sourceRound: null,
          sourceHeat: null,
          sourcePosition: slots.length + 1
        });
      }
    });
    heats.push({ round: 1, heatNumber: h, slots });
  }

  const finalSlots: SlotDescriptor[] = [
    {
      placeholder: placeholderLabel('Qualifié', 1, 1, 1),
      sourceRound: 1,
      sourceHeat: 1,
      sourcePosition: 1
    },
    {
      placeholder: placeholderLabel('Qualifié', 1, 1, 2),
      sourceRound: 1,
      sourceHeat: 1,
      sourcePosition: 2
    },
    {
      placeholder: placeholderLabel('Qualifié', 1, 2, 1),
      sourceRound: 1,
      sourceHeat: 2,
      sourcePosition: 1
    },
    {
      placeholder: placeholderLabel('Qualifié', 1, 2, 2),
      sourceRound: 1,
      sourceHeat: 2,
      sourcePosition: 2
    }
  ];

  return [
    ...heats,
    {
      round: 2,
      heatNumber: 1,
      slots: finalSlots
    }
  ];
};

const buildEightPerson = (participants: ParticipantInput[]): PlannedHeat[] => {
  const firstRound: PlannedHeat[] = [];
  for (let i = 0; i < 2; i++) {
    const surfers = Array(4)
      .fill(null)
      .map((_, idx) => participants[i * 4 + idx])
      .filter(Boolean)
      .map((participant, idx) => ({
        participant,
        sourceRound: null,
        sourceHeat: null,
        sourcePosition: idx + 1
      }));
    firstRound.push({ round: 1, heatNumber: i + 1, slots: surfers });
  }

  const final = {
    round: 2,
    heatNumber: 1,
    slots: [
      {
        placeholder: placeholderLabel('Qualifié', 1, 1, 1),
        sourceRound: 1,
        sourceHeat: 1,
        sourcePosition: 1
      },
      {
        placeholder: placeholderLabel('Qualifié', 1, 1, 2),
        sourceRound: 1,
        sourceHeat: 1,
        sourcePosition: 2
      },
      {
        placeholder: placeholderLabel('Qualifié', 1, 2, 1),
        sourceRound: 1,
        sourceHeat: 2,
        sourcePosition: 1
      },
      {
        placeholder: placeholderLabel('Qualifié', 1, 2, 2),
        sourceRound: 1,
        sourceHeat: 2,
        sourcePosition: 2
      }
    ]
  };

  return [...firstRound, final];
};

const buildGenericElimination = (
  participants: ParticipantInput[],
  heatSize: number
): PlannedHeat[] => {
  const rounds: PlannedHeat[] = [];

  const firstRoundHeats = chunkSlots(
    participants.map(participant => ({
      participant,
      sourceRound: null,
      sourceHeat: null,
      sourcePosition: null
    })),
    heatSize
  ).map((slots, idx) => ({
    round: 1,
    heatNumber: idx + 1,
    slots: slots.map((slot, slotIdx) => ({
      participant: slot.participant,
      sourceRound: null,
      sourceHeat: null,
      sourcePosition: slotIdx + 1
    }))
  }));

  rounds.push(...firstRoundHeats);

  let qualifiers: SlotDescriptor[] = [];
  firstRoundHeats.forEach(heat => {
    const advPerHeat = Math.max(1, Math.floor(heat.slots.length / 2));
    for (let pos = 1; pos <= advPerHeat && pos <= heat.slots.length; pos++) {
      qualifiers.push({
        placeholder: placeholderLabel('Qualifié', heat.round, heat.heatNumber, pos),
        sourceRound: heat.round,
        sourceHeat: heat.heatNumber,
        sourcePosition: pos
      });
    }
  });

  let currentRound = 2;
  while (qualifiers.length > 0) {
    if (qualifiers.length <= heatSize) {
      rounds.push({
        round: currentRound,
        heatNumber: 1,
        slots: qualifiers
      });
      break;
    }

    const nextRoundHeats = chunkSlots(qualifiers, heatSize).map((slots, idx) => ({
      round: currentRound,
      heatNumber: idx + 1,
      slots
    }));

    rounds.push(...nextRoundHeats);

    const nextQualifiers: SlotDescriptor[] = [];
    nextRoundHeats.forEach(heat => {
      const advPerHeat = Math.max(1, Math.floor(heat.slots.length / 2));
      for (let pos = 1; pos <= advPerHeat && pos <= heat.slots.length; pos++) {
        nextQualifiers.push({
          placeholder: placeholderLabel('Qualifié', heat.round, heat.heatNumber, pos),
          sourceRound: heat.round,
          sourceHeat: heat.heatNumber,
          sourcePosition: pos
        });
      }
    });

    if (nextQualifiers.length === qualifiers.length) {
      rounds.push({
        round: currentRound + 1,
        heatNumber: 1,
        slots: qualifiers
      });
      break;
    }

    qualifiers = nextQualifiers;
    currentRound += 1;
  }

  return rounds;
};

const buildRepechage = (
  participants: ParticipantInput[],
  heatSize: number,
  cfg: RepechageConfig
): PlannedHeat[] => {
  const sortedParticipants = [...participants];
  const rounds: PlannedHeat[] = [];
  const mainHeats = chunkSlots(
    sortedParticipants.map(participant => ({
      participant,
      sourceRound: null,
      sourceHeat: null,
      sourcePosition: null
    })),
    heatSize
  ).map((slots, idx) => ({
    round: 1,
    heatNumber: idx + 1,
    slots: slots.map((slot, slotIdx) => ({
      participant: slot.participant,
      sourceRound: null,
      sourceHeat: null,
      sourcePosition: slotIdx + 1
    }))
  }));

  rounds.push(...mainHeats);

  const directFinalQualifiers: SlotDescriptor[] = [];
  const repechageEntries: SlotDescriptor[] = [];

  mainHeats.forEach(heat => {
    for (let pos = 1; pos <= cfg.advMainPerHeat && pos <= heat.slots.length; pos++) {
      directFinalQualifiers.push({
        placeholder: placeholderLabel('Qualifié', heat.round, heat.heatNumber, pos),
        sourceRound: heat.round,
        sourceHeat: heat.heatNumber,
        sourcePosition: pos
      });
    }

    for (
      let pos = cfg.advMainPerHeat + 1;
      pos <= cfg.advMainPerHeat + cfg.toRepPerHeat && pos <= heat.slots.length;
      pos++
    ) {
      repechageEntries.push({
        placeholder: placeholderLabel('Repêchage', heat.round, heat.heatNumber, pos),
        sourceRound: heat.round,
        sourceHeat: heat.heatNumber,
        sourcePosition: pos
      });
    }
  });

  let currentRound = 2;
  let repQualifiers: SlotDescriptor[] = [];

  if (cfg.enabled && repechageEntries.length > 0) {
    const repHeats = chunkSlots(repechageEntries, heatSize).map((slots, idx) => ({
      round: currentRound,
      heatNumber: idx + 1,
      slots
    }));

    rounds.push(...repHeats);

    repHeats.forEach(heat => {
      for (let pos = 1; pos <= cfg.advRepPerHeat && pos <= heat.slots.length; pos++) {
        repQualifiers.push({
          placeholder: placeholderLabel('Qualifié', heat.round, heat.heatNumber, pos),
          sourceRound: heat.round,
          sourceHeat: heat.heatNumber,
          sourcePosition: pos
        });
      }
    });

    currentRound += 1;
  }

  const finalSlots = [...directFinalQualifiers, ...repQualifiers];
  if (finalSlots.length === 0) {
    finalSlots.push(
      ...directFinalQualifiers,
      ...repechageEntries
    );
  }

  rounds.push({
    round: currentRound,
    heatNumber: 1,
    slots: finalSlots
  });

  return rounds;
};

const convertToSupabaseRows = (
  plannedHeats: PlannedHeat[],
  context: { eventName: string; division: string; eventId: number }
) => {
  const heats: HeatRow[] = [];
  const entries: HeatEntryRow[] = [];
  const slotMappings: HeatSlotMappingRow[] = [];

  plannedHeats.forEach(heatPlan => {
    const heatId = makeHeatId(context.eventName, context.division, heatPlan.round, heatPlan.heatNumber);
    const heatSize = heatPlan.slots.length;
    const colors = getColorSet(heatSize);

    heats.push({
      id: heatId,
      event_id: context.eventId,
      competition: context.eventName,
      division: context.division,
      round: heatPlan.round,
      heat_number: heatPlan.heatNumber,
      heat_size: heatSize,
      status: 'waiting',
      color_order: colors
    });

    heatPlan.slots.forEach((slot, idx) => {
      const color = colors[idx] ?? null;
      const position = idx + 1;
      entries.push({
        heat_id: heatId,
        participant_id: slot.participant?.participantId ?? slot.participant?.seed ?? null,
        position,
        seed: slot.participant?.seed ?? 0,
        color
      });
      slotMappings.push({
        heat_id: heatId,
        position,
        placeholder: slot.placeholder ?? null,
        source_round: slot.sourceRound ?? null,
        source_heat: slot.sourceHeat ?? null,
        source_position: slot.sourcePosition ?? null
      });
    });
  });

  return { heats, entries, slotMappings };
};

export const generateHeatDraw = (input: HeatGeneratorInput) => {
  if (!input.eventName || !input.division) {
    throw new Error('eventName and division are required');
  }
  if (!Array.isArray(input.surfers) || input.surfers.length === 0) {
    throw new Error('At least one surfer is required to generate heats');
  }
  if (input.heatSize < 1) {
    throw new Error('heatSize must be >= 1');
  }

  const surfers = ensureSeedsContinuity(input.surfers);
  const eventId = Number.isFinite(input.eventId) ? Number(input.eventId) : 0;
  const repechage = input.repechage;

  let plannedHeats: PlannedHeat[];

  if (repechage?.enabled) {
    plannedHeats = buildRepechage(surfers, input.heatSize, repechage);
  } else if (input.heatSize === 2) {
    plannedHeats = buildManOnMan(surfers);
  } else if (surfers.length === 6) {
    plannedHeats = buildSixPerson(surfers, input.heatSize);
  } else if (surfers.length === 8 && input.heatSize >= 4) {
    plannedHeats = buildEightPerson(surfers);
  } else {
    plannedHeats = buildGenericElimination(surfers, input.heatSize);
  }

  return convertToSupabaseRows(plannedHeats, {
    eventName: input.eventName,
    division: input.division,
    eventId
  });
};
