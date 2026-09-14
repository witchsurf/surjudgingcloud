/**
 * fieldOrganization — domain layer
 *
 * Holds the business logic for loading and caching the field organisation
 * profile (name + logo) without importing infrastructure directly.
 *
 * Data fetching is injected by callers (see services/fieldOrganizationService.ts)
 * so this module stays within the domain layer dependency rules.
 */

import { getDeploymentMode } from './deploymentMode';

export interface FieldOrganizationProfile {
  organizationName: string;
  logoDataUrl: string;
  updatedAt: string;
}

export type FieldOrganizationRow = {
  organization_name?: unknown;
  logo_data_url?: unknown;
  updated_at?: unknown;
} | null;

export type FieldOrganizationFetcher = () => Promise<FieldOrganizationRow>;

const STORAGE_KEY = 'surfjudging_field_organization_profile';
let cachedProfile: FieldOrganizationProfile | null | undefined;

export const normalizeRow = (row: FieldOrganizationRow): FieldOrganizationProfile | null => {
  const organizationName = typeof row?.organization_name === 'string' ? row.organization_name.trim() : '';
  const logoDataUrl = typeof row?.logo_data_url === 'string' ? row.logo_data_url : '';
  if (organizationName.length < 2 || !logoDataUrl.startsWith('data:image/png;base64,')) return null;
  return {
    organizationName,
    logoDataUrl,
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : '',
  };
};

const readStoredProfile = (): FieldOrganizationProfile | null => {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return normalizeRow({
      organization_name: parsed?.organizationName,
      logo_data_url: parsed?.logoDataUrl,
      updated_at: parsed?.updatedAt,
    });
  } catch {
    return null;
  }
};

const cacheProfile = (profile: FieldOrganizationProfile | null) => {
  cachedProfile = profile;
  if (typeof window === 'undefined' || !profile) return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage can be unavailable */ }
};

export const getCachedFieldOrganizationProfile = (): FieldOrganizationProfile | null => {
  if (getDeploymentMode() !== 'field') return null;
  if (cachedProfile === undefined) cachedProfile = readStoredProfile();
  return cachedProfile;
};

/**
 * Loads the field organisation profile.
 * The `fetcher` callback is injected by the caller so this domain module
 * does not import Supabase directly (preserves layer isolation).
 */
export async function loadFieldOrganizationProfile(
  fetcher: FieldOrganizationFetcher,
  { force = false } = {}
): Promise<FieldOrganizationProfile | null> {
  if (getDeploymentMode() !== 'field') return null;
  if (!force && cachedProfile !== undefined) return cachedProfile;
  const fallback = getCachedFieldOrganizationProfile();
  try {
    const data = await fetcher();
    const profile = normalizeRow(data);
    if (profile) cacheProfile(profile);
    return profile ?? fallback;
  } catch (err) {
    console.warn('Identité de l\u2019organisation Field indisponible, cache local conservé:', err);
    return fallback;
  }
}

export async function resolvePdfOrganizationIdentity(
  fetcher: FieldOrganizationFetcher,
  input: {
    organizer?: string | null;
    organizerLogoDataUrl?: string | null;
  } = {}
) {
  const fieldProfile = await loadFieldOrganizationProfile(fetcher, { force: true });
  return {
    organizer: fieldProfile?.organizationName || input.organizer || undefined,
    organizerLogoDataUrl: fieldProfile?.logoDataUrl || input.organizerLogoDataUrl || undefined,
  };
}

export const __resetFieldOrganizationCacheForTests = () => { cachedProfile = undefined; };
