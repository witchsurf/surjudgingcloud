/**
 * fieldOrganizationService — infrastructure bridge
 *
 * Provides the Supabase fetcher for domain/fieldOrganization.ts so that
 * the domain layer itself never imports Supabase directly.
 *
 * All application code that needs to load the field organisation profile
 * should import from this service rather than from the domain module directly.
 */

import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  loadFieldOrganizationProfile as _loadFieldOrganizationProfile,
  resolvePdfOrganizationIdentity as _resolvePdfOrganizationIdentity,
  getCachedFieldOrganizationProfile,
  type FieldOrganizationProfile,
  type FieldOrganizationRow,
} from '../domain/fieldOrganization';

export type { FieldOrganizationProfile };
export { getCachedFieldOrganizationProfile };

/** Supabase fetcher injected into the domain function. */
const supabaseFetcher = async (): Promise<FieldOrganizationRow> => {
  if (!isSupabaseConfigured() || !supabase) return null;
  const { data, error } = await supabase
    .from('field_organization_profile')
    .select('organization_name,logo_data_url,updated_at')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  return data as FieldOrganizationRow;
};

export const loadFieldOrganizationProfile = (options?: { force?: boolean }) =>
  _loadFieldOrganizationProfile(supabaseFetcher, options);

export const resolvePdfOrganizationIdentity = (input?: {
  organizer?: string | null;
  organizerLogoDataUrl?: string | null;
}) => _resolvePdfOrganizationIdentity(supabaseFetcher, input);
