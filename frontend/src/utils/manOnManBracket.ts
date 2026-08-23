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
}

export interface ManOnManBracket {
  matches: ManOnManMatch[];
  edges: ManOnManEdge[];
  byeCount: number;
}

/** Build a power-of-two bracket without representing BYEs as heats. */
export function buildManOnManBracket(qualifierCount: number, startRound = 1): ManOnManBracket {
  if (!Number.isInteger(qualifierCount) || qualifierCount < 2) throw new Error('At least two qualifiers are required');
  const bracketSize = 2 ** Math.ceil(Math.log2(qualifierCount));
  const byeCount = bracketSize - qualifierCount;
  const firstMatchCount = (bracketSize / 2) - byeCount;
  const matches: ManOnManMatch[] = [];
  const edges: ManOnManEdge[] = [];

  for (let i = 0; i < firstMatchCount; i += 1) {
    const heatNumber = i + 1;
    matches.push({ round: startRound, heatNumber, slots: [2 * i + 1, 2 * i + 2] });
  }

  type Source = { round: number; heat: number; position: number; bye?: boolean };
  let sources: Source[] = Array.from({ length: firstMatchCount }, (_, i) => ({ round: startRound, heat: i + 1, position: 1 }));
  sources.push(...Array.from({ length: byeCount }, () => ({ round: startRound, heat: 0, position: 0, bye: true })));
  let round = startRound + 1;
  while (sources.length > 1) {
    const nextSources: Source[] = [];
    for (let i = 0; i < sources.length; i += 2) {
      const left = sources[i];
      const right = sources[i + 1];
      if (!right) { nextSources.push(left); continue; }
      const heatNumber = (i / 2) + 1;
      matches.push({ round, heatNumber, slots: [1, 2] });
      [left, right].forEach((source, position) => {
        edges.push({ targetRound: round, targetHeat: heatNumber, targetPosition: position + 1, sourceRound: source.round, sourceHeat: source.heat, sourcePosition: source.position, type: source.bye ? 'AUTO_ADVANCE_BYE' : 'COMPETITION_RESULT' });
      });
      nextSources.push({ round, heat: heatNumber, position: 1 });
    }
    sources = nextSources;
    round += 1;
  }
  return { matches, edges, byeCount };
}
