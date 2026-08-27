export type ManOnManEdgeType = 'COMPETITION_RESULT' | 'AUTO_ADVANCE_BYE';

export interface ManOnManMatch {
  round: number;
  heatNumber: number;
  slots: number[];
}

export interface ManOnManEdge {
  targetRound: number;
  targetHeat: number;
  targetPosition: number;
  sourceRound: number;
  sourceHeat: number;
  sourcePosition: number;
  type: ManOnManEdgeType;
  byeSeed?: number;
}

export interface ManOnManBracket {
  matches: ManOnManMatch[];
  edges: ManOnManEdge[];
  byeCount: number;
}

const buildSeedOrder = (bracketSize: number): number[] => {
  let order = [1, 2];
  for (let size = 4; size <= bracketSize; size *= 2) {
    order = order.flatMap((seed) => [seed, size + 1 - seed]);
  }
  return order;
};

/** Build a power-of-two bracket without representing BYEs as heats. */
export function buildManOnManBracket(qualifierCount: number, startRound = 1): ManOnManBracket {
  if (!Number.isInteger(qualifierCount) || qualifierCount < 2) throw new Error('At least two qualifiers are required');
  const bracketSize = 2 ** Math.ceil(Math.log2(qualifierCount));
  const byeCount = bracketSize - qualifierCount;
  const firstMatchCount = (bracketSize / 2) - byeCount;
  const matches: ManOnManMatch[] = [];
  const edges: ManOnManEdge[] = [];

  type Source = { round: number; heat: number; position: number; byeSeed?: number };
  const seedOrder = buildSeedOrder(bracketSize);
  const sources: Source[] = [];
  let heatNumber = 0;

  for (let index = 0; index < seedOrder.length; index += 2) {
    const pair = seedOrder.slice(index, index + 2).filter((seed) => seed <= qualifierCount);
    if (pair.length === 2) {
      heatNumber += 1;
      matches.push({ round: startRound, heatNumber, slots: pair });
      sources.push({ round: startRound, heat: heatNumber, position: 1 });
    } else if (pair.length === 1) {
      sources.push({ round: startRound, heat: 0, position: 0, byeSeed: pair[0] });
    }
  }

  if (heatNumber !== firstMatchCount || sources.length !== bracketSize / 2) {
    throw new Error('Invalid man-on-man bracket construction');
  }

  let currentSources = sources;
  let round = startRound + 1;
  while (currentSources.length > 1) {
    const nextSources: Source[] = [];
    for (let i = 0; i < currentSources.length; i += 2) {
      const left = currentSources[i];
      const right = currentSources[i + 1];
      if (!right) { nextSources.push(left); continue; }
      const heatNumber = (i / 2) + 1;
      matches.push({ round, heatNumber, slots: [1, 2] });
      [left, right].forEach((source, position) => {
        edges.push({
          targetRound: round,
          targetHeat: heatNumber,
          targetPosition: position + 1,
          sourceRound: source.round,
          sourceHeat: source.heat,
          sourcePosition: source.position,
          type: source.byeSeed != null ? 'AUTO_ADVANCE_BYE' : 'COMPETITION_RESULT',
          ...(source.byeSeed != null ? { byeSeed: source.byeSeed } : {}),
        });
      });
      nextSources.push({ round, heat: heatNumber, position: 1 });
    }
    currentSources = nextSources;
    round += 1;
  }
  return { matches, edges, byeCount };
}
