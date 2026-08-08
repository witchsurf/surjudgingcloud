import { describe, expect, it, vi } from 'vitest';
import { resolvePanelContext } from '../panelContext';

const assignments = (count: number) => Array.from({ length: count }, (_, index) => ({
  station: `J${index + 1}`,
  judgeId: `judge-${index + 1}`,
}));

describe('canonical panel context', () => {
  it('resolves a three-judge panel from heat_configs', () => {
    expect(resolvePanelContext({ heatConfigJudges: ['J1', 'J2', 'J3'] })).toEqual({
      judgeCount: 3,
      source: 'heat_config',
    });
  });

  it('resolves a five-judge panel from heat_judge_assignments', () => {
    expect(resolvePanelContext({ assignments: assignments(5) })).toEqual({
      judgeCount: 5,
      source: 'assignments',
    });
  });

  it('uses the highest-priority source when coherent sources agree', () => {
    expect(resolvePanelContext({
      heatConfigJudges: ['J1', 'J2', 'J3'],
      assignments: assignments(3),
      runtimeSnapshotJudges: ['J1', 'J2', 'J3'],
    })).toEqual({
      judgeCount: 3,
      source: 'heat_config',
    });
  });

  it('does not choose silently when explicit sources conflict', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = resolvePanelContext({ heatConfigJudges: ['J1', 'J2', 'J3'], assignments: assignments(5) });
    expect(result).toMatchObject({ judgeCount: null, source: 'unknown', issue: 'panel_conflict' });
    expect(result.message).toContain('Conflit de panel');
    expect(error).toHaveBeenCalledWith('[P2 panel context conflict]', expect.any(Object));
    error.mockRestore();
  });

  it('returns an explicit unknown panel when no source exists', () => {
    expect(resolvePanelContext({})).toEqual({
      judgeCount: null,
      source: 'unknown',
      issue: 'panel_unknown',
      message: 'Panel inconnu : aucune configuration 3/5 explicite disponible.',
    });
  });

  it('keeps the real three-judge panel for history containing only two observed scores', () => {
    expect(resolvePanelContext({ heatConfigJudges: ['J1', 'J2', 'J3'], observedScoreCount: 2 })).toEqual({
      judgeCount: 3,
      source: 'heat_config',
    });
  });

  it('keeps the real five-judge panel for history containing only four observed scores', () => {
    expect(resolvePanelContext({ assignments: assignments(5), observedScoreCount: 4 })).toEqual({
      judgeCount: 5,
      source: 'assignments',
    });
  });

  it('uses a coherent runtime snapshot only when higher-priority sources are absent', () => {
    expect(resolvePanelContext({ runtimeSnapshotJudges: ['J1', 'J2', 'J3'] })).toEqual({
      judgeCount: 3,
      source: 'runtime_snapshot',
    });
  });

  it.each([1, 2, 4, 6])('rejects unsupported explicit panel size %s', (count) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = resolvePanelContext({ heatConfigJudges: Array.from({ length: count }, (_, index) => `J${index + 1}`) });
    expect(result).toMatchObject({ judgeCount: null, source: 'unknown', issue: 'panel_invalid' });
    expect(result.message).toContain(`panel ${count} non supporté`);
    error.mockRestore();
  });
});
