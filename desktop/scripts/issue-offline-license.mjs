#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalize } = require('../src/main/offline-license-service.cjs');
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const requestPath = value('--request');
const privateKeyPath = value('--issuer-private-key');
const keyId = value('--key-id');
const expiresAt = value('--expires-at');
const outputPath = value('--out');

if (!requestPath || !privateKeyPath || !keyId || !expiresAt || !outputPath) throw new Error('Usage: node scripts/issue-offline-license.mjs --request activation-request.json --issuer-private-key issuer-private.pem --key-id issuer-2026-01 --expires-at 2027-09-08T00:00:00.000Z --out offline-license.json');
if (Date.parse(expiresAt) <= Date.now()) throw new Error('La date d’expiration doit être dans le futur.');
const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
if (request?.productId !== 'surfjudging-field' || !request.installationId || !request.installationPublicKeyPem?.includes('BEGIN PUBLIC KEY')) throw new Error('Demande d’activation invalide.');
const privateKeyPem = await fs.readFile(privateKeyPath, 'utf8');
const payload = { version: 1, certificateId: crypto.randomUUID(), issuerKeyId: keyId, productId: request.productId, installationId: request.installationId, installationPublicKeyPem: request.installationPublicKeyPem, notBefore: new Date().toISOString(), expiresAt: new Date(expiresAt).toISOString(), entitlements: ['field-runtime'] };
const certificate = { payload, signature: crypto.sign(null, Buffer.from(canonicalize(payload)), privateKeyPem).toString('base64') };
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true, mode: 0o700 });
await fs.writeFile(outputPath, `${JSON.stringify(certificate, null, 2)}\n`, { mode: 0o600 });
console.log(`Licence créée : ${outputPath}`);
