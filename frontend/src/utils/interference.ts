import type { EffectiveInterference, InterferenceCall } from '../types';

type SurferInterferenceSummary = {
  count: number;
  type: 'INT1' | 'INT2' | null;
  isDisqualified: boolean;
};

const makeTargetKey = (surfer: string, waveNumber: number) => `${surfer.toUpperCase()}::${waveNumber}`;

export function computeEffectiveInterferences(
  calls: InterferenceCall[],
  judgeCount: number
): EffectiveInterference[] {
  if (!calls.length || judgeCount <= 0) return [];

  const byTarget = new Map<string, InterferenceCall[]>();
  for (const call of calls) {
    const key = makeTargetKey(call.surfer, Number(call.wave_number));
    const list = byTarget.get(key) ?? [];
    list.push(call);
    byTarget.set(key, list);
  }

  const threshold = Math.floor(judgeCount / 2) + 1;
  const effective: EffectiveInterference[] = [];

  byTarget.forEach((targetCalls) => {
    const sorted = [...targetCalls].sort((a, b) => {
      const aTs = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTs = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTs - aTs;
    });

    const override = sorted.find((c) => c.is_head_judge_override);
    if (override) {
      effective.push({
        surfer: override.surfer,
        waveNumber: Number(override.wave_number),
        type: override.call_type,
        source: 'head_judge',
      });
      return;
    }

    // Keep latest vote per judge for this target.
    const latestByJudge = new Map<string, InterferenceCall>();
    sorted.forEach((c) => {
      if (!latestByJudge.has(c.judge_id)) {
        latestByJudge.set(c.judge_id, c);
      }
    });

    let int1 = 0;
    let int2 = 0;
    latestByJudge.forEach((vote) => {
      if (vote.call_type === 'INT1') int1 += 1;
      if (vote.call_type === 'INT2') int2 += 1;
    });

    if (int2 >= threshold) {
      const ref = sorted.find((c) => c.call_type === 'INT2') ?? sorted[0];
      effective.push({
        surfer: ref.surfer,
        waveNumber: Number(ref.wave_number),
        type: 'INT2',
        source: 'majority',
      });
      return;
    }

    if (int1 >= threshold) {
      const ref = sorted.find((c) => c.call_type === 'INT1') ?? sorted[0];
      effective.push({
        surfer: ref.surfer,
        waveNumber: Number(ref.wave_number),
        type: 'INT1',
        source: 'majority',
      });
    }
  });

  return effective.sort((a, b) => {
    const surferDiff = a.surfer.localeCompare(b.surfer);
    if (surferDiff !== 0) return surferDiff;
    return a.waveNumber - b.waveNumber;
  });
}

export function summarizeInterferenceBySurfer(
  effective: EffectiveInterference[]
): Map<string, SurferInterferenceSummary> {
  const bySurfer = new Map<string, SurferInterferenceSummary>();

  effective.forEach((item) => {
    const key = item.surfer.toUpperCase();
    const current = bySurfer.get(key) ?? {
      count: 0,
      type: null,
      isDisqualified: false,
    };
    const nextCount = current.count + 1;
    bySurfer.set(key, {
      count: nextCount,
      type: current.type ?? item.type,
      isDisqualified: nextCount >= 2,
    });
  });

  return bySurfer;
}

