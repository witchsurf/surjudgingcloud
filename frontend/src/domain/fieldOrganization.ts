import { getDeploymentMode } from './deploymentMode';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface FieldOrganizationProfile {
  organizationName: string;
  logoDataUrl: string;
  updatedAt: string;
}

const STORAGE_KEY = 'surfjudging_field_organization_profile';
let cachedProfile: FieldOrganizationProfile | null | undefined;

const normalizeRow = (row: {
  organization_name?: unknown;
  logo_data_url?: unknown;
  updated_at?: unknown;
} | null): FieldOrganizationProfile | null => {
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

export async function loadFieldOrganizationProfile({ force = false } = {}): Promise<FieldOrganizationProfile | null> {
  if (getDeploymentMode() !== 'field') return null;
  if (!force && cachedProfile !== undefined) return cachedProfile;
  const fallback = getCachedFieldOrganizationProfile();
  if (!isSupabaseConfigured() || !supabase) return fallback;
  const { data, error } = await supabase
    .from('field_organization_profile')
    .select('organization_name,logo_data_url,updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) {
    console.warn('Identité de l’organisation Field indisponible, cache local conservé:', error.message);
    return fallback;
  }
  const profile = normalizeRow(data);
  if (profile) cacheProfile(profile);
  return profile ?? fallback;
}

export async function resolvePdfOrganizationIdentity(input: {
  organizer?: string | null;
  organizerLogoDataUrl?: string | null;
} = {}) {
  const fieldProfile = await loadFieldOrganizationProfile({ force:true });
  return {
    organizer: fieldProfile?.organizationName || input.organizer || undefined,
    organizerLogoDataUrl: fieldProfile?.logoDataUrl || input.organizerLogoDataUrl || undefined,
  };
}

export const __resetFieldOrganizationCacheForTests = () => { cachedProfile = undefined; };
