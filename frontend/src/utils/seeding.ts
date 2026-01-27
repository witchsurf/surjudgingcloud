export type SeedSlot = number | null;

export interface HeatSeedMap {
  heatNumber: number;
  seeds: SeedSlot[];
}

export interface SnakeOptions {
  heatSize: number;
  heatCount: number;
  heatSizes?: number[];
}

export function determineHeatSize(participantCount: number, preferred: number | 'auto' = 'auto'): number {
  if (preferred !== 'auto') {
    return Math.max(2, Math.min(4, preferred));
  }

  if (participantCount <= 4) return participantCount;
  if (participantCount <= 6) return 3;
  return 4;
}

export function determineHeatCount(participantCount: number, heatSize: number): number {
  return Math.max(1, Math.ceil(participantCount / Math.max(1, heatSize)));
}

export function distributeSeedsSnake(seeds: number[], options: SnakeOptions): HeatSeedMap[] {
  const { heatSize, heatCount, heatSizes } = options;
  if (heatCount <= 0) {
    throw new Error('heatCount must be > 0');
  }
  const capacities = heatSizes && heatSizes.length === heatCount
    ? heatSizes.map((size) => Math.max(0, size ?? 0))
    : Array.from({ length: heatCount }, () => heatSize);
  const totalSlots = capacities.reduce((sum, value) => sum + value, 0);
  const heats: SeedSlot[][] = Array.from({ length: heatCount }, () => []);
  const sortedSeeds = [...seeds].sort((a, b) => a - b);

  let index = 0;
  let direction: 1 | -1 = 1;

  const advanceIndex = (forceStep = false) => {
    if (heatCount === 1) return;
    if (direction === 1) {
      if (index === heatCount - 1) {
        direction = -1;
        if (forceStep) {
          index = Math.max(0, index - 1);
        }
      } else {
        index += 1;
      }
    } else if (index === 0) {
      direction = 1;
      if (forceStep) {
        index = Math.min(heatCount - 1, index + 1);
      }
    } else {
      index -= 1;
    }
  };

  const ensureCapacity = () => {
    if (capacities[index] === 0) return;
    let attempts = 0;
    while (heats[index].length >= capacities[index] && attempts < heatCount) {
      advanceIndex(true);
      attempts += 1;
    }
  };

  for (let i = 0; i < sortedSeeds.length; i += 1) {
    ensureCapacity();
    heats[index].push(sortedSeeds[i]);

    if (heatCount === 1) continue;
    advanceIndex();
  }

  const byes = Math.max(0, totalSlots - sortedSeeds.length);
  if (byes > 0) {
    let byeAdded = 0;
    for (let heatIdx = 0; heatIdx < heats.length && byeAdded < byes; heatIdx += 1) {
      const capacity = capacities[heatIdx];
      while (heats[heatIdx].length < capacity && byeAdded < byes) {
        heats[heatIdx].push(null);
        byeAdded += 1;
      }
    }
    if (byeAdded < byes) {
      let fallback = 0;
      while (byeAdded < byes) {
        heats[fallback % heatCount].push(null);
        fallback += 1;
        byeAdded += 1;
      }
    }
  }

  return heats.map((seedsInHeat, idx) => ({
    heatNumber: idx + 1,
    seeds: seedsInHeat,
  }));
}

export interface ParticipantSeed {
  seed: number;
  name: string;
  country?: string;
  license?: string;
  id?: number;
}

export function expandSeedMap(map: HeatSeedMap[], participants: ParticipantSeed[]): { heatNumber: number; slots: (ParticipantSeed | null)[] }[] {
  const lookup = new Map<number, ParticipantSeed>();
  participants.forEach((p) => lookup.set(p.seed, p));

  return map.map(({ heatNumber, seeds }) => ({
    heatNumber,
    slots: seeds.map((seed) => (seed == null ? null : lookup.get(seed) ?? null))
  }));
}
