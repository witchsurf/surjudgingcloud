import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_IDS, selectRuntimeProfile, validateRuntimeAdapter } from '../src/shared/host-runtime.js';

const base = { hostOS: 'darwin', hostArch: 'x64', dockerCli: false, dockerDaemonReachable: false, dockerServerOS: '', dockerServerArch: '', dockerServerVersion: '', vzCapability: 'requires-certified-matrix' };
test('unknown OS and architecture fail closed', () => {
  assert.equal(selectRuntimeProfile({ ...base, hostOS: 'plan9' }, { certifiedProfiles: new Set(Object.values(PROFILE_IDS)) }).profileId, null);
  assert.equal(selectRuntimeProfile({ ...base, hostArch: 'ppc64' }, { certifiedProfiles: new Set(Object.values(PROFILE_IDS)) }).profileId, null);
});
test('Docker CLI without daemon is rejected', () => assert.equal(selectRuntimeProfile({ ...base, dockerCli: true }, { certifiedProfiles: new Set([PROFILE_IDS.existingDocker]) }).profileId, null));
test('valid existing Docker is deterministic first priority', () => {
  const host = { ...base, dockerCli: true, dockerDaemonReachable: true, dockerServerOS: 'linux', dockerServerArch: 'amd64', dockerServerVersion: '27.0' };
  assert.equal(selectRuntimeProfile(host, { certifiedProfiles: new Set([PROFILE_IDS.existingDocker, PROFILE_IDS.legacy]) }).profileId, PROFILE_IDS.existingDocker);
});
test('uncertified VZ and legacy profiles are rejected', () => {
  assert.equal(selectRuntimeProfile(base, { certifiedProfiles: new Set([PROFILE_IDS.vz]) }).profileId, null);
  assert.equal(selectRuntimeProfile(base, { certifiedProfiles: new Set([PROFILE_IDS.legacy]) }).profileId, PROFILE_IDS.legacy);
});
test('adapter contract and hash are fail closed', () => {
  const methods = ['runtime_detect','runtime_preflight','runtime_start','runtime_stop','runtime_status','runtime_socket','runtime_import_image','runtime_compose','runtime_cleanup_failed_install'];
  const adapter = { sha256: 'abc' }; for (const m of methods) adapter[m] = () => null;
  assert.equal(validateRuntimeAdapter(adapter, 'abc'), true);
  assert.equal(validateRuntimeAdapter(adapter, 'wrong'), false);
});
