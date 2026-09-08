import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalize, makeOfflineLicenseService, verifyCertificate } = require('../src/main/offline-license-service.cjs');

function secureStorage() {
  return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => Buffer.from(value).toString('utf8') };
}

function signedCertificate({ privateKeyPem, keyId, identity, expiresAt = '2027-01-01T00:00:00.000Z' }) {
  const payload = { version: 1, certificateId: crypto.randomUUID(), issuerKeyId: keyId, productId: 'surfjudging-field', installationId: identity.installationId, installationPublicKeyPem: identity.installationPublicKeyPem || identity.publicKeyPem, notBefore: '2026-01-01T00:00:00.000Z', expiresAt, entitlements: ['field-runtime'] };
  return { payload, signature: crypto.sign(null, Buffer.from(canonicalize(payload)), privateKeyPem).toString('base64') };
}

test('a signed license is bound to exactly one installation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surfjudging-license-'));
  const issuer = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = issuer.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = issuer.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const service = makeOfflineLicenseService({ root, safeStorage: secureStorage(), now: () => new Date('2026-09-08T00:00:00.000Z'), policy: { enforcement: 'required', trustedIssuers: [{ keyId: 'issuer-1', publicKeyPem }] } });
  const request = (await service.status()).activationRequest;
  const certificate = signedCertificate({ privateKeyPem, keyId: 'issuer-1', identity: request });
  const installed = await service.installCertificate(certificate);
  assert.equal(installed.allowed, true);
  const other = { ...request, installationId: crypto.randomUUID() };
  assert.equal(verifyCertificate(certificate, other, service.policy, new Date('2026-09-08T00:00:00.000Z')).reason, 'WRONG_INSTALLATION');
});

test('a required policy blocks an unsigned or expired certificate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surfjudging-license-'));
  const issuer = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = issuer.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = issuer.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const service = makeOfflineLicenseService({ root, safeStorage: secureStorage(), now: () => new Date('2026-09-08T00:00:00.000Z'), policy: { enforcement: 'required', trustedIssuers: [{ keyId: 'issuer-1', publicKeyPem }] } });
  const request = (await service.status()).activationRequest;
  const expired = signedCertificate({ privateKeyPem, keyId: 'issuer-1', identity: request, expiresAt: '2026-09-07T00:00:00.000Z' });
  await assert.rejects(service.installCertificate(expired), /EXPIRED/);
  assert.equal((await service.status()).allowed, false);
});
