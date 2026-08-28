import { beforeEach, describe, expect, it, vi } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));
vi.mock('../deploymentMode', () => ({ getDeploymentMode: () => 'field' }));

import {
  __resetFieldOrganizationCacheForTests,
  loadFieldOrganizationProfile,
  resolvePdfOrganizationIdentity,
} from '../fieldOrganization';

describe('Field organization identity', () => {
  beforeEach(() => {
    localStorage.clear();
    maybeSingle.mockReset();
    __resetFieldOrganizationCacheForTests();
  });

  it('loads and caches the authoritative Field organization', async () => {
    maybeSingle.mockResolvedValue({data:{organization_name:'LARAISE',logo_data_url:'data:image/png;base64,AAAA',updated_at:'2026-08-28T00:00:00Z'},error:null});
    await expect(loadFieldOrganizationProfile({force:true})).resolves.toMatchObject({organizationName:'LARAISE'});
    expect(localStorage.getItem('surfjudging_field_organization_profile')).toContain('LARAISE');
  });

  it('makes the Field organization authoritative for official PDFs', async () => {
    maybeSingle.mockResolvedValue({data:{organization_name:'LARAISE',logo_data_url:'data:image/png;base64,AAAA',updated_at:'2026-08-28T00:00:00Z'},error:null});
    await expect(resolvePdfOrganizationIdentity({organizer:'Ancien organisateur'})).resolves.toEqual({
      organizer:'LARAISE',
      organizerLogoDataUrl:'data:image/png;base64,AAAA',
    });
  });
});
