import { describe, expect, it } from 'vitest';
import type { EffectiveInterference, Score } from '../../../types';
import { calculateSurferStats } from '../../../utils/scoring';
import { calculateHeatResult, InvalidOfficialScoreError, UnsupportedPanelSizeError } from '../engine';
import type { HeatScoringInput, InterferenceDecision, ScoreFact, SupportedPanelSize } from '../contracts';

const timestamp = (minute: number) => `2026-03-23T10:${String(minute).padStart(2, '0')}:00.000Z`;

const score = (
  judgeStation: string,
  waveNumber: number,
  value: number,
  lycraColor = 'ROUGE',
  minute = waveNumber,
  id = `${lycraColor}-${waveNumber}-${judgeStation}-${minute}-${value}`,
): ScoreFact => ({
  id,
  heatId: 'heat-p2-parity',
  lycraColor,
  waveNumber,
  judgeStation,
  value,
  timestamp: timestamp(minute),
  createdAt: timestamp(minute),
});

const toLegacyScore = (fact: ScoreFact): Score => ({
  id: fact.id,
  heat_id: fact.heatId,
  competition: 'P2 parity',
  division: 'OPEN',
  round: 1,
  judge_id: fact.judgeStation,
  judge_name: fact.judgeStation,
  judge_station: fact.judgeStation,
  judge_identity_id: fact.judgeIdentityId || undefined,
  surfer: fact.lycraColor,
  wave_number: fact.waveNumber,
  score: fact.value,
  timestamp: fact.timestamp,
  created_at: fact.createdAt,
});

const toLegacyInterferences = (decisions: readonly InterferenceDecision[]): EffectiveInterference[] => decisions.map((decision) => ({
  surfer: decision.lycraColor,
  waveNumber: decision.waveNumber,
  type: decision.type,
  source: decision.source === 'panel' ? 'majority' : 'head_judge',
}));

const comparableLegacy = (
  scores: readonly ScoreFact[],
  colors: readonly string[],
  panelSize: SupportedPanelSize,
  maxWaves: number,
  decisions: readonly InterferenceDecision[] = [],
) => calculateSurferStats(
  scores.map(toLegacyScore),
  [...colors],
  panelSize,
  maxWaves,
  false,
  toLegacyInterferences(decisions),
).map((competitor) => ({
  lycraColor: competitor.surfer,
  waves: competitor.waves.map((wave) => ({
    waveNumber: wave.wave,
    average: wave.score,
    judgeScores: wave.judgeScores,
    complete: wave.isComplete,
  })),
  total: competitor.bestTwo,
  rank: competitor.rank,
  disqualified: Boolean(competitor.isDisqualified),
}));

const comparableEngine = (input: HeatScoringInput) => calculateHeatResult(input).competitors.map((competitor) => ({
  lycraColor: competitor.lycraColor,
  waves: competitor.waves.map((wave) => ({
    waveNumber: wave.waveNumber,
    average: wave.average,
    judgeScores: wave.judgeScores,
    complete: wave.complete,
  })),
  total: competitor.total,
  rank: competitor.rank,
  disqualified: competitor.disqualified,
}));

const expectParity = (
  scores: readonly ScoreFact[],
  colors: readonly string[],
  panelSize: SupportedPanelSize,
  maxWaves = 12,
  decisions: readonly InterferenceDecision[] = [],
) => {
  const input: HeatScoringInput = {
    heatId: 'heat-p2-parity',
    panel: { size: panelSize, stations: Array.from({ length: panelSize }, (_, index) => `J${index + 1}`) },
    lineup: colors.map((lycraColor) => ({ lycraColor, participant: null })),
    scores,
    effectiveInterferences: decisions,
    maxWaves,
    calculatedAt: timestamp(59),
  };
  expect(comparableEngine(input)).toEqual(comparableLegacy(scores, colors, panelSize, maxWaves, decisions));
};

describe('P2 engine / P0 legacy parity', () => {
  it('matches nominal three-judge scoring, rounding and two best waves', () => {
    expectParity([
      score('J1', 1, 6.1), score('J2', 1, 6.2), score('J3', 1, 6.2),
      score('J1', 2, 8.1), score('J2', 2, 8.2), score('J3', 2, 8.2),
      score('J1', 3, 7.1), score('J2', 3, 7.2), score('J3', 3, 7.2),
    ], ['ROUGE'], 3);
  });

  it.each([
    [2, 5, 6, 7, 10],
    [2, 2, 5, 7, 9],
    [2, 5, 8, 9, 9],
    [2, 2, 5, 9, 9],
  ])('matches five judges and removes one min/max for %j', (...values: number[]) => {
    expectParity(values.map((value, index) => score(`J${index + 1}`, 1, value)), ['ROUGE'], 5);
  });

  it.each([
    { panel: 3 as const, values: [6, 8] },
    { panel: 5 as const, values: [4, 5, 6, 7] },
  ])('keeps incomplete waves visible but excluded with $panel judges', ({ panel, values }) => {
    expectParity(values.map((value, index) => score(`J${index + 1}`, 1, value)), ['ROUGE'], panel);
  });

  it('matches last-write-wins when corrections arrive out of order', () => {
    expectParity([
      score('J1', 1, 9, 'ROUGE', 2, 'new'),
      score('J1', 1, 3, 'ROUGE', 1, 'old'),
      score('J2', 1, 6),
      score('J3', 1, 6),
    ].reverse(), ['ROUGE'], 3);
  });

  it.each(['INT1', 'INT2'] as const)('matches the current %s interference penalty order', (type) => {
    const decisions: InterferenceDecision[] = [{
      lycraColor: 'BLANC', waveNumber: 2, type, source: 'panel', disqualified: false,
    }];
    expectParity([
      score('J1', 1, 8, 'WHITE'), score('J2', 1, 8, 'WHITE'), score('J3', 1, 8, 'WHITE'),
      score('J1', 2, 6, 'WHITE'), score('J2', 2, 6, 'WHITE'), score('J3', 2, 6, 'WHITE'),
    ], ['WHITE'], 3, 4, decisions);
  });

  it('matches disqualification after two effective interferences', () => {
    const decisions: InterferenceDecision[] = [
      { lycraColor: 'ROUGE', waveNumber: 1, type: 'INT1', source: 'panel', disqualified: false },
      { lycraColor: 'ROUGE', waveNumber: 2, type: 'INT1', source: 'panel', disqualified: true },
    ];
    expectParity([
      score('J1', 1, 8), score('J2', 1, 8), score('J3', 1, 8),
      score('J1', 2, 6), score('J2', 2, 6), score('J3', 2, 6),
      score('J1', 1, 7, 'BLANC'), score('J2', 1, 7, 'BLANC'), score('J3', 1, 7, 'BLANC'),
    ], ['ROUGE', 'BLANC'], 3, 4, decisions);
  });

  it('matches current tied ranking and preserves scores when participant display changes', () => {
    const scores = [
      score('J1', 1, 7), score('J2', 1, 7), score('J3', 1, 7),
      score('J1', 1, 7, 'BLANC'), score('J2', 1, 7, 'BLANC'), score('J3', 1, 7, 'BLANC'),
      score('J1', 1, 6, 'JAUNE'), score('J2', 1, 6, 'JAUNE'), score('J3', 1, 6, 'JAUNE'),
    ];
    expectParity(scores, ['ROUGE', 'BLANC', 'JAUNE'], 3);
    const base: HeatScoringInput = {
      heatId: 'heat-p2-parity', panel: { size: 3, stations: ['J1', 'J2', 'J3'] }, scores,
      lineup: [{ lycraColor: 'ROUGE', participant: { participantId: 1, displayName: 'Initial' } }],
      calculatedAt: timestamp(59),
    };
    const before = calculateHeatResult(base).competitors[0];
    const after = calculateHeatResult({ ...base, lineup: [{ lycraColor: 'ROUGE', participant: { participantId: 2, displayName: 'Remplaçant' } }] }).competitors[0];
    expect(after.waves).toEqual(before.waves);
    expect(after.total).toBe(before.total);
    expect(after.lycraColor).toBe('ROUGE');
  });
});

describe('approved P2 divergences and guards', () => {
  const inputWith = (value: number): HeatScoringInput => ({
    heatId: 'heat-policy', panel: { size: 3, stations: ['J1', 'J2', 'J3'] },
    lineup: [{ lycraColor: 'ROUGE', participant: null }], scores: [score('J1', 1, value)],
  });

  it('rejects zero while the reversible legacy validator still accepts it', () => {
    expect(() => calculateHeatResult(inputWith(0))).toThrow(InvalidOfficialScoreError);
  });

  it.each([0.1, 10])('accepts official boundary %s', (value) => {
    expect(() => calculateHeatResult(inputWith(value))).not.toThrow();
  });

  it.each([10.1, 7.25])('rejects out-of-policy value %s', (value) => {
    expect(() => calculateHeatResult(inputWith(value))).toThrow(InvalidOfficialScoreError);
  });

  it.each([1, 2, 4, 6])('does not invent scoring for legacy panel size %s', (size) => {
    const invalid = { ...inputWith(5), panel: { size, stations: [] } } as unknown as HeatScoringInput;
    expect(() => calculateHeatResult(invalid)).toThrow(UnsupportedPanelSizeError);
  });

  it('uses timestamp as the primary deterministic last-write-wins criterion', () => {
    const base = score('J1', 1, 5, 'ROUGE', 1, 'a');
    const facts = [
      base,
      { ...base, id: 'b', value: 6 },
      { ...base, id: 'c', value: 7, createdAt: timestamp(2) },
      { ...base, id: 'd', value: 8, timestamp: timestamp(3), createdAt: timestamp(1) },
      score('J2', 1, 8), score('J3', 1, 8),
    ];
    const result = calculateHeatResult({ ...inputWith(5), scores: facts });
    expect(result.competitors[0].waves[0].judgeScores.J1).toBe(8);
  });

  it('uses createdAt then stable id when timestamps are identical', () => {
    const base = score('J1', 1, 5, 'ROUGE', 1, 'a');
    const sameTimestamp = [
      base,
      { ...base, id: 'b', value: 6 },
      { ...base, id: 'c', value: 7, createdAt: timestamp(2) },
      score('J2', 1, 8), score('J3', 1, 8),
    ];
    const createdAtResult = calculateHeatResult({ ...inputWith(5), scores: sameTimestamp });
    expect(createdAtResult.competitors[0].waves[0].judgeScores.J1).toBe(7);

    const identicalDates = [base, { ...base, id: 'b', value: 6 }, score('J2', 1, 8), score('J3', 1, 8)];
    const stableIdResult = calculateHeatResult({ ...inputWith(5), scores: identicalDates });
    expect(stableIdResult.competitors[0].waves[0].judgeScores.J1).toBe(6);
  });
});
