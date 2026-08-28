const fs = require('node:fs/promises');
const path = require('node:path');

const PROFILE_FILE = 'organization.json';
const LOGO_FILE = 'organization-logo.png';
const MAX_LOGO_BYTES = 8 * 1024 * 1024;

function normalizeOrganizationName(value) {
  if (typeof value !== 'string') throw new Error('Le nom de l’organisation est requis.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new Error('Le nom de l’organisation doit contenir entre 2 et 120 caractères.');
  return name;
}

function decodePngDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) {
    throw new Error('Le logo doit être une image PNG valide.');
  }
  const buffer = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
  if (!buffer.length || buffer.length > MAX_LOGO_BYTES) throw new Error('Le logo doit peser moins de 8 Mo.');
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Le logo doit être une image PNG valide.');
  }
  return buffer;
}

async function readOrganizationProfile(root) {
  try {
    const profile = JSON.parse(await fs.readFile(path.join(root, PROFILE_FILE), 'utf8'));
    const organizationName = normalizeOrganizationName(profile.organizationName);
    const logo = await fs.readFile(path.join(root, LOGO_FILE));
    return {
      configured: true,
      organizationName,
      logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`,
      updatedAt: profile.updatedAt || null,
    };
  } catch {
    return { configured: false, organizationName: '', logoDataUrl: null, updatedAt: null };
  }
}

async function saveOrganizationProfile(root, input) {
  const organizationName = normalizeOrganizationName(input?.organizationName);
  const logo = decodePngDataUrl(input?.logoDataUrl);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const logoPath = path.join(root, LOGO_FILE);
  const profilePath = path.join(root, PROFILE_FILE);
  await fs.writeFile(`${logoPath}.next`, logo, { mode: 0o600 });
  await fs.rename(`${logoPath}.next`, logoPath);
  const profile = { organizationName, updatedAt: new Date().toISOString() };
  await fs.writeFile(`${profilePath}.next`, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${profilePath}.next`, profilePath);
  return readOrganizationProfile(root);
}

module.exports = {
  LOGO_FILE,
  MAX_LOGO_BYTES,
  normalizeOrganizationName,
  decodePngDataUrl,
  readOrganizationProfile,
  saveOrganizationProfile,
};
