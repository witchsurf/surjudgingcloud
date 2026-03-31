import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../types';
import { mergeRealtimeConfigPreservingLineup } from '../realtimeConfigMerge';

const baseConfig = (): AppConfig => ({
  competition: 'TEST OFF NET',
  division: 'CADET',
  round: 1,
  heatId: 1,
  judges: ['J1', 'J2', 'J3'],
  surfers: ['ROUGE', 'BLANC', 'JAUNE'],
  waves: 15,
  judgeNames: {},
  surferNames: {
    ROUGE: 'SALIF SADIO',
    BLANC: 'DIMITRI KHOKH',
    JAUNE: 'JAMEH SIERRA',
  },
  surferCountries: {
    ROUGE: 'SENEGAL',
    BLANC: 'OUGANDA',
    JAUNE: 'MALAWI',
  },
  totalSurfers: 3,
  surfersPerHeat: 3,
  totalHeats: 1,
  totalRounds: 1,
});

describe('mergeRealtimeConfigPreservingLineup', () => {
  it('preserves a hydrated 3-surfer lineup when realtime sends a degraded 4-slot config for the same heat', () => {
    const prev = baseConfig();

    const merged = mergeRealtimeConfigPreservingLineup(prev, {
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: {},
      surferCountries: {},
    });

    expect(merged.surfers).toEqual(['ROUGE', 'BLANC', 'JAUNE']);
    expect(merged.surfersPerHeat).toBe(3);
    expect(merged.surferNames).toEqual(prev.surferNames);
    expect(merged.surferCountries).toEqual(prev.surferCountries);
  });

  it('accepts a richer realtime config when it improves the active heat lineup', () => {
    const prev = {
      ...baseConfig(),
      surfers: ['ROUGE', 'BLANC', 'JAUNE'],
      surferNames: {},
      surferCountries: {},
      surfersPerHeat: 3,
    };

    const merged = mergeRealtimeConfigPreservingLineup(prev, {
      surfers: ['ROUGE', 'BLANC', 'JAUNE'],
      surferNames: {
        ROUGE: 'SALIF SADIO',
        BLANC: 'DIMITRI KHOKH',
        JAUNE: 'JAMEH SIERRA',
      },
      surferCountries: {
        ROUGE: 'SENEGAL',
      },
    });

    expect(merged.surfers).toEqual(['ROUGE', 'BLANC', 'JAUNE']);
    expect(merged.surferNames?.ROUGE).toBe('SALIF SADIO');
    expect(merged.surfersPerHeat).toBe(3);
  });

  it('allows a heat switch to replace the lineup', () => {
    const prev = baseConfig();

    const merged = mergeRealtimeConfigPreservingLineup(prev, {
      division: 'CADET',
      round: 1,
      heatId: 2,
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      surferNames: {
        ROUGE: 'A',
        BLANC: 'B',
        JAUNE: 'C',
        BLEU: 'D',
      },
      surferCountries: {},
    });

    expect(merged.heatId).toBe(2);
    expect(merged.surfers).toEqual(['ROUGE', 'BLANC', 'JAUNE', 'BLEU']);
    expect(merged.surfersPerHeat).toBe(4);
  });
});
