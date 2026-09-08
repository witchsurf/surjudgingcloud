const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PRODUCT_ID = 'surfjudging-field';
const IDENTITY_FILE = 'installation-identity.json';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function installationFingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex');
}

function validatePolicy(policy) {
  const normalized = policy && typeof policy === 'object' ? policy : {};
  const enforcement = normalized.enforcement || 'disabled';
  if (!['disabled', 'required'].includes(enforcement)) throw new Error('Politique de licence invalide : enforcement inconnu.');
  const trustedIssuers = Array.isArray(normalized.trustedIssuers) ? normalized.trustedIssuers : [];
  const issuers = trustedIssuers.map((issuer) => ({ keyId: String(issuer?.keyId || '').trim(), publicKeyPem: String(issuer?.publicKeyPem || '').trim() }));
  if (enforcement === 'required' && !issuers.length) throw new Error('Politique de licence invalide : aucun émetteur approuvé.');
  if (issuers.some((issuer) => !issuer.keyId || !issuer.publicKeyPem.includes('BEGIN PUBLIC KEY'))) throw new Error('Politique de licence invalide : clé publique émetteur absente.');
  return { schemaVersion: 1, productId: normalized.productId || PRODUCT_ID, enforcement, trustedIssuers: issuers };
}

function verifyCertificate(certificate, identity, policy, now = new Date()) {
  if (!certificate || typeof certificate !== 'object') return { valid: false, reason: 'NO_LICENSE' };
  const payload = certificate.payload;
  if (!payload || typeof payload !== 'object' || typeof certificate.signature !== 'string') return { valid: false, reason: 'MALFORMED_LICENSE' };
  const issuer = policy.trustedIssuers.find((entry) => entry.keyId === payload.issuerKeyId);
  if (!issuer) return { valid: false, reason: 'UNTRUSTED_ISSUER' };
  let signatureValid = false;
  try { signatureValid = crypto.verify(null, Buffer.from(canonicalize(payload)), issuer.publicKeyPem, Buffer.from(certificate.signature, 'base64')); } catch { return { valid: false, reason: 'INVALID_SIGNATURE' }; }
  if (!signatureValid) return { valid: false, reason: 'INVALID_SIGNATURE' };
  if (payload.productId !== policy.productId) return { valid: false, reason: 'WRONG_PRODUCT' };
  if (payload.installationId !== identity.installationId || payload.installationPublicKeyPem !== identity.publicKeyPem) return { valid: false, reason: 'WRONG_INSTALLATION' };
  const nowMs = now.getTime();
  if (Number.isNaN(Date.parse(payload.notBefore)) || Number.isNaN(Date.parse(payload.expiresAt))) return { valid: false, reason: 'INVALID_DATES' };
  if (nowMs < Date.parse(payload.notBefore)) return { valid: false, reason: 'NOT_YET_VALID' };
  if (nowMs > Date.parse(payload.expiresAt)) return { valid: false, reason: 'EXPIRED' };
  return { valid: true, reason: 'ACTIVE', payload };
}

function makeOfflineLicenseService({ root, policy, safeStorage, now = () => new Date(), platform = process.platform, arch = process.arch, appVersion = 'unknown' }) {
  const normalizedPolicy = validatePolicy(policy);
  const identityPath = path.join(root, IDENTITY_FILE);
  const certificatePath = path.join(root, 'offline-license.json');
  const encryptionAvailable = () => Boolean(safeStorage?.isEncryptionAvailable?.());

  async function readIdentity() {
    try {
      const stored = JSON.parse(await fs.readFile(identityPath, 'utf8'));
      if (!stored.installationId || !stored.publicKeyPem || !stored.privateKeyEncrypted) throw new Error('identity incomplete');
      if (!encryptionAvailable()) return { error: 'SECURE_STORAGE_UNAVAILABLE' };
      const privateKeyPem = safeStorage.decryptString(Buffer.from(stored.privateKeyEncrypted, 'base64'));
      if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) throw new Error('private key invalid');
      return { installationId: stored.installationId, publicKeyPem: stored.publicKeyPem, privateKeyPem };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      return { error: 'IDENTITY_UNREADABLE' };
    }
  }

  async function identity() {
    const existing = await readIdentity();
    if (existing) return existing;
    if (!encryptionAvailable()) return { error: 'SECURE_STORAGE_UNAVAILABLE' };
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const installationId = crypto.randomUUID();
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const stored = { version: 1, installationId, publicKeyPem, privateKeyEncrypted: safeStorage.encryptString(privateKeyPem).toString('base64'), createdAt: now().toISOString() };
    const next = `${identityPath}.next`;
    await fs.writeFile(next, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(next, identityPath);
    return { installationId, publicKeyPem, privateKeyPem };
  }

  async function readCertificate() {
    try { return JSON.parse(await fs.readFile(certificatePath, 'utf8')); } catch (error) { return error?.code === 'ENOENT' ? null : { malformed: true }; }
  }

  async function status() {
    const currentIdentity = await identity();
    if (currentIdentity.error) return { allowed: normalizedPolicy.enforcement === 'disabled', state: currentIdentity.error, enforcement: normalizedPolicy.enforcement, activationRequest: null };
    const certificate = await readCertificate();
    const verification = verifyCertificate(certificate, currentIdentity, normalizedPolicy, now());
    const activationRequest = { version: 1, productId: normalizedPolicy.productId, installationId: currentIdentity.installationId, installationPublicKeyPem: currentIdentity.publicKeyPem, installationFingerprint: installationFingerprint(currentIdentity.publicKeyPem), platform, arch, appVersion };
    return { allowed: normalizedPolicy.enforcement === 'disabled' || verification.valid, state: verification.reason, enforcement: normalizedPolicy.enforcement, activationRequest, certificate: verification.valid ? verification.payload : null };
  }

  async function installCertificate(certificateText) {
    const candidate = typeof certificateText === 'string' ? JSON.parse(certificateText) : certificateText;
    const currentIdentity = await identity();
    if (currentIdentity.error) throw new Error('Le stockage sécurisé de cette machine est indisponible.');
    const verification = verifyCertificate(candidate, currentIdentity, normalizedPolicy, now());
    if (!verification.valid) throw new Error(`Licence refusée : ${verification.reason}.`);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const next = `${certificatePath}.next`;
    await fs.writeFile(next, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(next, certificatePath);
    return status();
  }

  return Object.freeze({ status, installCertificate, identity, verifyCertificate: (certificate, currentIdentity) => verifyCertificate(certificate, currentIdentity, normalizedPolicy, now()), policy: normalizedPolicy });
}

module.exports = { PRODUCT_ID, IDENTITY_FILE, canonicalize, installationFingerprint, validatePolicy, verifyCertificate, makeOfflineLicenseService };
