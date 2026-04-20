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
  source_round: number | null;
  source_heat: number | null;
  source_position: number | null;
}

type SlotReference = {
  sourceRound: number;
  heatNumber: number | null;
  position: number | null;
  bestSecondRound?: number;
};

type Assignment = {
  heatId: string;
  capacity: number;
  refs: SlotReference[];
};

type SnakeCursor = {
  index: number;
  direction: 1 | -1;
};

const maxAdvancersForHeatSize = (heatSize: number) => {
  if (heatSize <= 0) return 0;
  if (heatSize <= 2) return 1;
  return 2;
};

const makePlaceholder = (ref: SlotReference) =>
  ref.bestSecondRound
    ? `Meilleur 2e R${ref.bestSecondRound}`
    : `R${ref.sourceRound}-H${ref.heatNumber}-P${ref.position}`;

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
  const assignments: Assignment[] = targetHeats.map((heat) => ({
    heatId: heat.id,
    capacity: Math.max(0, Number(heat.heat_size) || 0),
    refs: [],
  }));

  if (!assignments.length || !refs.length) return assignments;

  let index = 0;
  let direction: 1 | -1 = 1;

  refs.forEach((ref) => {
    let fallback: SnakeCursor | null = null;
    let chosen: SnakeCursor | null = null;
    let candidateIndex = index;
    let candidateDirection = direction;

    for (let guard = 0; guard < assignments.length * 2; guard += 1) {
      const assignment = assignments[candidateIndex];
      const hasCapacity = assignment && assignment.refs.length < assignment.capacity;

      if (hasCapacity) {
        fallback ??= { index: candidateIndex, direction: candidateDirection };
        const hasSourceHeatCollision = assignment.refs.some(
          (existing) =>
            existing.heatNumber != null &&
            ref.heatNumber != null &&
            existing.sourceRound === ref.sourceRound &&
            existing.heatNumber === ref.heatNumber
        );

        if (!hasSourceHeatCollision) {
          chosen = { index: candidateIndex, direction: candidateDirection };
          break;
        }
      }

      const moved = moveSnakeCursor(candidateIndex, candidateDirection, assignments.length);
      candidateIndex = moved.index;
      candidateDirection = moved.direction;
    }

    chosen ??= fallback;
    if (!chosen) {
      return;
    }

    assignments[chosen.index].refs.push(ref);
    const moved = moveSnakeCursor(chosen.index, chosen.direction, assignments.length);
    index = moved.index;
    direction = moved.direction;
  });

  return assignments;
};

const buildLayeredQualifierRefs = (
  previousRoundHeats: HeatSequenceLike[],
  requestedAdvancersPerHeat: number,
  totalCurrentRoundSlots: number
) => {
  const refs: SlotReference[] = [];

  for (let position = 1; position <= requestedAdvancersPerHeat; position += 1) {
    previousRoundHeats.forEach((heat) => {
      const heatSize = Math.max(0, Number(heat.heat_size) || 0);
      const advancers = Math.min(maxAdvancersForHeatSize(heatSize), requestedAdvancersPerHeat);
      if (position > advancers) return;

      refs.push({
        sourceRound: Number(heat.round),
        heatNumber: Number(heat.heat_number),
        position,
      });
    });
  }

  if (refs.length < totalCurrentRoundSlots && previousRoundHeats.length > 1) {
    refs.push({
      sourceRound: Number(previousRoundHeats[0].round),
      heatNumber: null,
      position: null,
      bestSecondRound: Number(previousRoundHeats[0].round),
    });
  }

  return refs;
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
  const refs = buildLayeredQualifierRefs(previousRoundHeats, requestedAdvancersPerHeat, totalCurrentRoundSlots);

  if (!refs.length) return [];

  const assignments = distributeReferencesSnakeVariable(refs, currentRoundHeats);
  const targetAssignment = assignments.find((assignment) => assignment.heatId === targetHeatId);
  if (!targetAssignment?.refs.length) return [];

  return targetAssignment.refs.map((ref, index) => ({
    heat_id: targetHeatId,
    position: index + 1,
    placeholder: makePlaceholder(ref),
    source_round: ref.bestSecondRound ? null : ref.sourceRound,
    source_heat: ref.heatNumber,
    source_position: ref.position,
  }));
}
