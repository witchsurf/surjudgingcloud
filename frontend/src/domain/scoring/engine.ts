import {
  OFFICIAL_SCORING_POLICY,
  validateOfficialScore,
  type CompetitorHeatResult,
  type HeatResultSnapshot,
  type HeatScoringInput,
  type InterferenceDecision,
  type InterferenceVote,
  type ScoreFact,
  type SupportedPanelSize,
  type WaveResult,
} from './contracts';

const LYCRA_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  RED: 'RED', ROUGE: 'RED',
  WHITE: 'WHITE', BLANC: 'WHITE',
  YELLOW: 'YELLOW', JAUNE: 'YELLOW',
  BLUE: 'BLUE', BLEU: 'BLUE',
  GREEN: 'GREEN', VERT: 'GREEN',
  BLACK: 'BLACK', NOIR: 'BLACK',
});

const roundTo = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const normalizeLycraColor = (value: string): string => {
  const normalized = (value || '').trim().toUpperCase();
  return LYCRA_ALIASES[normalized] || normalized;
};

export class UnsupportedPanelSizeError extends Error {
  constructor(readonly panelSize: number) {
    super(`Unsupported scoring panel size: ${panelSize}. Official sizes are 3 and 5.`);
    this.name = 'UnsupportedPanelSizeError';
  }
}

export class InvalidOfficialScoreError extends Error {
  constructor(readonly score: ScoreFact, readonly reason: string) {
    super(`Invalid official score ${score.value} for ${score.id}: ${reason}`);
    this.name = 'InvalidOfficialScoreError';
  }
}

const assertPanelSize = (size: number): asserts size is SupportedPanelSize => {
  if (size !== 3 && size !== 5) throw new UnsupportedPanelSizeError(size);
};

const compareLatestFirst = (left: ScoreFact, right: ScoreFact): number => {
  const timestamp = right.timestamp.localeCompare(left.timestamp);
  if (timestamp !== 0) return timestamp;
  const createdAt = right.createdAt.localeCompare(left.createdAt);
  if (createdAt !== 0) return createdAt;
  return right.id.localeCompare(left.id);
};

const averageWave = (values: readonly number[], panelSize: SupportedPanelSize, complete: boolean) => {
  const retained = [...values];
  if (panelSize === 5 && complete) {
    retained.sort((a, b) => a - b);
    retained.splice(retained.length - 1, 1);
    retained.splice(0, 1);
  }
  const average = retained.length
    ? roundTo(retained.reduce((total, value) => total + value, 0) / retained.length, OFFICIAL_SCORING_POLICY.waveAverageDecimalPlaces)
    : 0;
  return { retained, average };
};

type InterferenceSummary = {
  count: number;
  type: 'INT1' | 'INT2' | null;
  disqualified: boolean;
};

const summarizeInterferences = (decisions: readonly InterferenceDecision[]) => {
  const summaries = new Map<string, InterferenceSummary>();
  decisions.forEach((decision) => {
    const key = normalizeLycraColor(decision.lycraColor);
    const current = summaries.get(key) || { count: 0, type: null, disqualified: false };
    const count = current.count + 1;
    summaries.set(key, {
      count,
      type: current.type || decision.type,
      disqualified: decision.disqualified || count >= 2,
    });
  });
  return summaries;
};

export function computeEffectiveInterferenceDecisions(
  votes: readonly InterferenceVote[],
  panelSize: SupportedPanelSize,
): InterferenceDecision[] {
  assertPanelSize(panelSize);
  const groups = new Map<string, InterferenceVote[]>();
  votes.forEach((vote) => {
    const key = `${normalizeLycraColor(vote.lycraColor)}::${vote.waveNumber}`;
    groups.set(key, [...(groups.get(key) || []), vote]);
  });
  const threshold = Math.floor(panelSize / 2) + 1;
  const decisions: InterferenceDecision[] = [];

  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => {
      const timestamp = b.timestamp.localeCompare(a.timestamp);
      if (timestamp !== 0) return timestamp;
      const createdAt = b.createdAt.localeCompare(a.createdAt);
      if (createdAt !== 0) return createdAt;
      return b.id.localeCompare(a.id);
    });
    const override = sorted.find((vote) => vote.headJudgeOverride);
    if (override) {
      decisions.push({
        lycraColor: normalizeLycraColor(override.lycraColor),
        waveNumber: override.waveNumber,
        type: override.type,
        source: 'head_judge',
        disqualified: false,
      });
      return;
    }
    const latestByJudge = new Map<string, InterferenceVote>();
    sorted.forEach((vote) => {
      if (!latestByJudge.has(vote.judgeStation)) latestByJudge.set(vote.judgeStation, vote);
    });
    const counts = { INT1: 0, INT2: 0 };
    latestByJudge.forEach((vote) => { counts[vote.type] += 1; });
    const type = counts.INT2 >= threshold ? 'INT2' : counts.INT1 >= threshold ? 'INT1' : null;
    if (type) {
      const reference = sorted.find((vote) => vote.type === type) || sorted[0];
      decisions.push({
        lycraColor: normalizeLycraColor(reference.lycraColor),
        waveNumber: reference.waveNumber,
        type,
        source: 'panel',
        disqualified: false,
      });
    }
  });

  return decisions.sort((a, b) => normalizeLycraColor(a.lycraColor).localeCompare(normalizeLycraColor(b.lycraColor)) || a.waveNumber - b.waveNumber);
}

export function calculateHeatResult(input: HeatScoringInput): HeatResultSnapshot {
  assertPanelSize(input.panel.size);
  const maxWaves = input.maxWaves ?? 12;
  const decisions = input.effectiveInterferences || [];
  const summaries = summarizeInterferences(decisions);

  input.scores.forEach((score) => {
    const validation = validateOfficialScore(score.value);
    if (!validation.valid) throw new InvalidOfficialScoreError(score, validation.reason || 'invalid');
  });

  const competitors = input.lineup.map<CompetitorHeatResult>((entry) => {
    const lycraColor = (entry.lycraColor || '').trim().toUpperCase();
    const normalizedLycraColor = normalizeLycraColor(lycraColor);
    const waveJudgeScores = new Map<number, Record<string, number>>();
    input.scores
      .filter((score) => normalizeLycraColor(score.lycraColor) === normalizedLycraColor)
      .sort(compareLatestFirst)
      .forEach((score) => {
        if (score.waveNumber < 1 || score.waveNumber > maxWaves) return;
        const scores = waveJudgeScores.get(score.waveNumber) || {};
        if (scores[score.judgeStation] === undefined) scores[score.judgeStation] = score.value;
        waveJudgeScores.set(score.waveNumber, scores);
      });

    const allWaves: WaveResult[] = Array.from({ length: maxWaves }, (_, index) => {
      const waveNumber = index + 1;
      const judgeScores = waveJudgeScores.get(waveNumber) || {};
      const values = Object.values(judgeScores);
      const complete = values.length === input.panel.size;
      const { retained, average } = averageWave(values, input.panel.size, complete);
      return { waveNumber, judgeScores, retainedScores: retained, average, complete, countsTowardsTotal: complete };
    });
    let lastWaveWithData = -1;
    allWaves.forEach((wave, index) => {
      if (wave.average > 0 || Object.keys(wave.judgeScores).length > 0) lastWaveWithData = index;
    });
    let waves = lastWaveWithData >= 0 ? allWaves.slice(0, lastWaveWithData + 1) : allWaves.slice(0, 1);
    const sortedComplete = waves.filter((wave) => wave.complete).sort((a, b) => b.average - a.average);
    const best = sortedComplete.slice(0, OFFICIAL_SCORING_POLICY.bestWaveCount);
    const summary = summaries.get(normalizedLycraColor);
    const waveA = best[0]?.average || 0;
    const waveB = best[1]?.average || 0;
    let total = roundTo(waveA + waveB, 2);
    const penalizedWave = best[1]?.waveNumber;
    if (summary?.disqualified) total = 0;
    else if (summary?.type === 'INT1') total = roundTo(waveA + waveB / 2, 2);
    else if (summary?.type === 'INT2') total = roundTo(waveA, 2);
    if (penalizedWave && summary?.type) {
      waves = waves.map((wave) => wave.waveNumber !== penalizedWave ? wave : {
        ...wave,
        average: summary.type === 'INT1' ? roundTo(wave.average / 2, 2) : 0,
      });
    }
    return {
      lycraColor,
      participant: entry.participant,
      waves,
      bestWaveNumbers: best.map((wave) => wave.waveNumber),
      total,
      rank: 1,
      disqualified: Boolean(summary?.disqualified),
      interferenceCount: summary?.count || 0,
      interferenceType: summary?.type || null,
      interferenceWaves: decisions
        .filter((decision) => normalizeLycraColor(decision.lycraColor) === normalizedLycraColor)
        .map((decision) => ({ waveNumber: decision.waveNumber, type: decision.type }))
        .sort((a, b) => a.waveNumber - b.waveNumber),
    };
  });

  const eligible = competitors.filter((competitor) => !competitor.disqualified).sort((a, b) => b.total - a.total || a.lycraColor.localeCompare(b.lycraColor));
  let previousTotal: number | null = null;
  let currentRank = 0;
  const rankByColor = new Map<string, number>();
  eligible.forEach((competitor, index) => {
    if (previousTotal === null || competitor.total !== previousTotal) currentRank = index + 1;
    previousTotal = competitor.total;
    rankByColor.set(competitor.lycraColor, currentRank);
  });
  const disqualifiedRank = eligible.length + 1;
  const ranked = competitors.map((competitor) => ({
    ...competitor,
    rank: competitor.disqualified ? disqualifiedRank : (rankByColor.get(competitor.lycraColor) || 1),
  })).sort((a, b) => Number(a.disqualified) - Number(b.disqualified) || a.rank - b.rank || a.lycraColor.localeCompare(b.lycraColor));

  return { heatId: input.heatId, panel: input.panel, competitors: ranked, calculatedAt: input.calculatedAt || new Date().toISOString() };
}
