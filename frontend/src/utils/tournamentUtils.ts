export interface TournamentStructure {
  totalRounds: number;
  totalHeats: number;
  heatsPerRound: number[];
  surfersPerHeat: number;
}

const getAdvancingCount = (heatSize: number) => Math.max(1, Math.ceil(heatSize / 2));

export function calculateTournamentStructure(
  totalSurfers: number,
  surfersPerHeat: number,
  tournamentType: 'elimination' | 'repechage'
): TournamentStructure {
  if (totalSurfers <= 0 || surfersPerHeat <= 0) {
    return {
      totalRounds: 1,
      totalHeats: 1,
      heatsPerRound: [1],
      surfersPerHeat: 4
    };
  }

  if (tournamentType === 'elimination') {
    return calculateEliminationStructure(totalSurfers, surfersPerHeat);
  } else {
    return calculateRepechageStructure(totalSurfers, surfersPerHeat);
  }
}

function calculateEliminationStructure(totalSurfers: number, surfersPerHeat: number): TournamentStructure {
  const rounds: number[] = [];
  let currentSurfers = totalSurfers;
  const advancingPerHeat = getAdvancingCount(surfersPerHeat);

  // Round 1 : tous les surfeurs
  const round1Heats = Math.ceil(totalSurfers / surfersPerHeat);
  rounds.push(round1Heats);
  
  // Calculer les qualifiés du round 1
  currentSurfers = round1Heats * advancingPerHeat;

  // Rounds suivants jusqu'à la finale
  while (currentSurfers > surfersPerHeat) {
    const heatsThisRound = Math.ceil(currentSurfers / surfersPerHeat);
    rounds.push(heatsThisRound);
    const nextSurfers = heatsThisRound * advancingPerHeat;
    if (nextSurfers >= currentSurfers) {
      // Safety guard against non-decreasing loops for edge inputs.
      currentSurfers = heatsThisRound;
      break;
    }
    currentSurfers = nextSurfers;
  }

  // Finale
  if (currentSurfers > 1) {
    rounds.push(1); // Une seule finale
  }

  return {
    totalRounds: rounds.length,
    totalHeats: rounds.reduce((sum, heats) => sum + heats, 0),
    heatsPerRound: rounds,
    surfersPerHeat
  };
}

function calculateRepechageStructure(totalSurfers: number, surfersPerHeat: number): TournamentStructure {
  const rounds: number[] = [];
  const advancingPerHeat = getAdvancingCount(surfersPerHeat);
  
  // Round 1 : tous les surfeurs
  const round1Heats = Math.ceil(totalSurfers / surfersPerHeat);
  rounds.push(round1Heats);
  
  // Round 2 : repêchage des éliminés du round 1
  const eliminatedRound1 = round1Heats * Math.max(0, surfersPerHeat - advancingPerHeat);
  if (eliminatedRound1 > 0) {
    const round2Heats = Math.ceil(eliminatedRound1 / surfersPerHeat);
    rounds.push(round2Heats);
  }
  
  // Demi-finales : qualifiés round 1 + qualifiés repêchage
  const qualifiedRound1 = round1Heats * advancingPerHeat;
  const qualifiedRound2 = rounds.length > 1 ? rounds[1] * advancingPerHeat : 0;
  const totalQualified = qualifiedRound1 + qualifiedRound2;
  
  if (totalQualified > surfersPerHeat) {
    const semiHeats = Math.ceil(totalQualified / surfersPerHeat);
    rounds.push(semiHeats);
  }
  
  // Finale
  rounds.push(1);

  return {
    totalRounds: rounds.length,
    totalHeats: rounds.reduce((sum, heats) => sum + heats, 0),
    heatsPerRound: rounds,
    surfersPerHeat
  };
}

export function getHeatInfo(
  currentRound: number,
  currentHeat: number,
  structure: TournamentStructure
): {
  roundName: string;
  heatName: string;
  isLastHeat: boolean;
  isLastRound: boolean;
  nextRound?: number;
  nextHeat?: number;
} {
  const isLastRound = currentRound === structure.totalRounds;
  const heatsInCurrentRound = structure.heatsPerRound[currentRound - 1] || 1;
  const isLastHeat = currentHeat >= heatsInCurrentRound;

  let roundName = `Round ${currentRound}`;
  if (structure.totalRounds > 1) {
    if (currentRound === structure.totalRounds) {
      roundName = 'FINALE';
    } else if (currentRound === structure.totalRounds - 1) {
      roundName = 'DEMI-FINALE';
    } else if (currentRound === 2 && structure.heatsPerRound.length > 2) {
      roundName = 'REPÊCHAGE';
    }
  }

  const heatName = `Heat ${currentHeat}`;

  let nextRound = currentRound;
  let nextHeat = currentHeat + 1;

  if (isLastHeat && !isLastRound) {
    nextRound = currentRound + 1;
    nextHeat = 1;
  }

  return {
    roundName,
    heatName,
    isLastHeat,
    isLastRound,
    nextRound: isLastRound && isLastHeat ? undefined : nextRound,
    nextHeat: isLastRound && isLastHeat ? undefined : nextHeat
  };
}
