export interface HeatSequenceLike {
  id: string;
  round: number;
  heat_number: number;
  heat_size: number | null;
}

export interface InferredHeatSlotMapping {
  heat_id: string;
  position: number;
  placeholder: string;
  source_round: number;
  source_heat: number;
  source_position: number;
}

type SlotReference = {
  sourceRound: number;
  heatNumber: number;
  position: number;
};

const maxAdvancersForHeatSize = (heatSize: number) => {
  if (heatSize <= 0) return 0;
  if (heatSize <= 2) return 1;
  return 2;
};

const makePlaceholder = (ref: SlotReference) =>
  `R${ref.sourceRound}-H${ref.heatNumber}-P${ref.position}`;

const moveSnakeCursor = (
  index: number,
  direction: 1 | -1,
  heatCount: number
): { index: number; direction: 1 | -1 } => {
  if (heatCount <= 1) return { index: 0, direction: 1 };

  if (direction === 1) {
    if (index === heatCount - 1) return { index, direction: -1 };
    return { index: index + 1, direction };
  }

  if (index === 0) return { index, direction: 1 };
  return { index: index - 1, direction };
};

const distributeReferencesSnakeVariable = (
  refs: SlotReference[],
  targetHeats: HeatSequenceLike[]
) => {
  const assignments = targetHeats.map((heat) => ({
    heatId: heat.id,
    capacity: Math.max(0, Number(heat.heat_size) || 0),
    refs: [] as SlotReference[],
  }));

  if (!assignments.length || !refs.length) return assignments;

  let index = 0;
  let direction: 1 | -1 = 1;

  refs.forEach((ref) => {
    let guard = 0;
    while (assignments[index]?.refs.length >= assignments[index]?.capacity && guard < assignments.length * 2) {
      const moved = moveSnakeCursor(index, direction, assignments.length);
      index = moved.index;
      direction = moved.direction;
      guard += 1;
    }

    if (!assignments[index] || assignments[index].capacity <= 0) {
      return;
    }

    assignments[index].refs.push(ref);
    const moved = moveSnakeCursor(index, direction, assignments.length);
    index = moved.index;
    direction = moved.direction;
  });

  return assignments;
};

export function inferImplicitMappingsForHeat(
  sequence: HeatSequenceLike[],
  targetHeatId: string
): InferredHeatSlotMapping[] {
  if (!sequence.length || !targetHeatId) return [];

  const ordered = [...sequence].sort((a, b) => {
    if (Number(a.round) !== Number(b.round)) return Number(a.round) - Number(b.round);
    return Number(a.heat_number) - Number(b.heat_number);
  });

  const targetHeat = ordered.find((heat) => heat.id === targetHeatId);
  if (!targetHeat || Number(targetHeat.round) <= 1) return [];

  const previousRoundNumber = Number(targetHeat.round) - 1;
  const previousRoundHeats = ordered
    .filter((heat) => Number(heat.round) === previousRoundNumber)
    .sort((a, b) => Number(a.heat_number) - Number(b.heat_number));
  const currentRoundHeats = ordered
    .filter((heat) => Number(heat.round) === Number(targetHeat.round))
    .sort((a, b) => Number(a.heat_number) - Number(b.heat_number));

  if (!previousRoundHeats.length || !currentRoundHeats.length) return [];

  const totalCurrentRoundSlots = currentRoundHeats.reduce(
    (sum, heat) => sum + Math.max(0, Number(heat.heat_size) || 0),
    0
  );
  if (totalCurrentRoundSlots <= 0) return [];

  const requestedAdvancersPerHeat = Math.max(1, Math.ceil(totalCurrentRoundSlots / previousRoundHeats.length));
  const refs: SlotReference[] = [];

  previousRoundHeats.forEach((heat) => {
    const heatSize = Math.max(0, Number(heat.heat_size) || 0);
    const advancers = Math.min(maxAdvancersForHeatSize(heatSize), requestedAdvancersPerHeat);
    for (let position = 1; position <= advancers; position += 1) {
      refs.push({
        sourceRound: Number(heat.round),
        heatNumber: Number(heat.heat_number),
        position,
      });
    }
  });

  if (!refs.length) return [];

  const assignments = distributeReferencesSnakeVariable(refs, currentRoundHeats);
  const targetAssignment = assignments.find((assignment) => assignment.heatId === targetHeatId);
  if (!targetAssignment?.refs.length) return [];

  return targetAssignment.refs.map((ref, index) => ({
    heat_id: targetHeatId,
    position: index + 1,
    placeholder: makePlaceholder(ref),
    source_round: ref.sourceRound,
    source_heat: ref.heatNumber,
    source_position: ref.position,
  }));
}
