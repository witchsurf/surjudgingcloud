import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const heatManagerSource = readFileSync(resolve(__dirname, '../useHeatManager.ts'), 'utf8');
const lifecycleSource = readFileSync(resolve(__dirname, '../../repositories/HeatLifecycleRepository.ts'), 'utf8');
const adminSource = readFileSync(resolve(__dirname, '../../components/AdminInterface.tsx'), 'utf8');

describe('qualification recovery flow boundaries', () => {
  it('returns after atomic close before any manual propagation call', () => {
    const atomicGuard = heatManagerSource.indexOf('if (atomicCloseSucceeded)');
    const recoveryCall = heatManagerSource.indexOf('qualificationRecoveryRepository.propagateSourceHeat');
    expect(atomicGuard).toBeGreaterThan(-1);
    expect(recoveryCall).toBeGreaterThan(atomicGuard);
    expect(heatManagerSource.slice(atomicGuard, recoveryCall)).toMatch(/return;/);
  });

  it('keeps manual propagation after the legacy close/status path', () => {
    const legacyClose = heatManagerSource.indexOf("updateHeatStatus(currentDbHeatId, 'closed'");
    const recoveryCall = heatManagerSource.indexOf('qualificationRecoveryRepository.propagateSourceHeat');
    expect(legacyClose).toBeGreaterThan(-1);
    expect(recoveryCall).toBeGreaterThan(legacyClose);
  });

  it('does not couple nominal lifecycle close to recovery RPCs', () => {
    expect(lifecycleSource).not.toMatch(/propagateQualifiersForSourceHeat|rebuildDivisionQualifiersFromScores|QualificationRecovery/);
  });

  it('keeps rebuild RPC before the existing Admin client fallback', () => {
    const rebuildCall = adminSource.indexOf('qualificationRecoveryRepository.rebuildDivision');
    const legacyFallback = adminSource.indexOf('const sequence = await fetchOrderedHeatSequence', rebuildCall);
    expect(rebuildCall).toBeGreaterThan(-1);
    expect(legacyFallback).toBeGreaterThan(rebuildCall);
  });
});
