import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFromManifest, isPrivateLanAddress, mapHealth, selectCandidate, tabletUrls, validateManifest } from '../src/shared/field.js';

test('filters loopback, link-local, Docker and accepts private LAN', () => {
  assert.equal(isPrivateLanAddress('127.0.0.1'), false); assert.equal(isPrivateLanAddress('169.254.1.2'), false);
  assert.equal(isPrivateLanAddress('172.18.0.2'), true); assert.equal(isPrivateLanAddress('10.0.0.10'), true);
});
test('validates Field manifest identity', () => { assert.equal(validateManifest({ deploymentMode:'cloud' }).valid, false); assert.equal(validateManifest({ deploymentMode:'field', releaseId:'r', codeRevision:'c', expectedSchemaVersion:'s' }).valid, true); });
test('selects only one candidate unless explicitly selected', () => { const a=candidateFromManifest('10.0.0.10',{deploymentMode:'field',releaseId:'r',codeRevision:'c',expectedSchemaVersion:'s'}); const b=candidateFromManifest('192.168.1.74',{deploymentMode:'field',releaseId:'r2',codeRevision:'c2',expectedSchemaVersion:'s'}); assert.equal(selectCandidate([a]),a); assert.equal(selectCandidate([a,b]),null); assert.equal(selectCandidate([a,b],'192.168.1.74'),b); });
test('generates current tablet routes', () => { assert.deepEqual(tabletUrls('10.0.0.10'), {admin:'http://10.0.0.10:8080/admin',judge:'http://10.0.0.10:8080/judge',priority:'http://10.0.0.10:8080/priority',display:'http://10.0.0.10:8080/display',overlay:'http://10.0.0.10:8080/overlay'}); });
test('maps health without faking unknown', () => { assert.equal(mapHealth(true),'HEALTHY'); assert.equal(mapHealth(false),'UNAVAILABLE'); assert.equal(mapHealth(false,true),'UNKNOWN'); });
