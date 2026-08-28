export const FIELD_PORTS = Object.freeze({ frontend: 8080, api: 8000 });

export function isPrivateLanAddress(address) {
  if (!address || address === '127.0.0.1' || address === '::1' || address.startsWith('169.254.')) return false;
  if (/^10\./.test(address) || /^192\.168\./.test(address)) return true;
  const m = address.match(/^172\.(\d+)\./);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

export function validateManifest(manifest) {
  if (!manifest || manifest.deploymentMode !== 'field') return { valid: false, reason: 'deploymentMode is not field' };
  for (const key of ['releaseId', 'codeRevision', 'expectedSchemaVersion']) {
    if (typeof manifest[key] !== 'string' || !manifest[key]) return { valid: false, reason: `missing ${key}` };
  }
  return { valid: true, reason: null };
}

export function candidateFromManifest(host, manifest) {
  const result = validateManifest(manifest);
  return result.valid ? { host, manifest, urls: tabletUrls(host) } : null;
}

export function tabletUrls(host) {
  const base = `http://${host}:${FIELD_PORTS.frontend}`;
  return Object.freeze({
    admin: `${base}/admin`, judge: `${base}/judge`, priority: `${base}/priority`, priorityDisplay: `${base}/priority-display`,
    display: `${base}/display`, overlay: `${base}/overlay`
  });
}

export function mapHealth(ok, unknown = false) {
  if (unknown) return 'UNKNOWN';
  return ok ? 'HEALTHY' : 'UNAVAILABLE';
}

export function selectCandidate(candidates, selectedHost = null) {
  if (selectedHost) return candidates.find((candidate) => candidate.host === selectedHost) ?? null;
  return candidates.length === 1 ? candidates[0] : null;
}
