import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../deploymentMode', () => ({ getDeploymentMode: () => 'field' }));

import {
  __resetFieldOrganizationCacheForTests,
  loadFieldOrganizationProfile,
  resolvePdfOrganizationIdentity,
  type FieldOrganizationRow,
} from '../fieldOrganization';

const mockRow: FieldOrganizationRow = {
  organization_name: 'LARAISE',
  logo_data_url: 'data:image/png;base64,AAAA',
  updated_at: '2026-08-28T00:00:00Z',
};

const mockFetcher = vi.fn<[], Promise<FieldOrganizationRow>>();

describe('Field organization identity', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetcher.mockReset();
    __resetFieldOrganizationCacheForTests();
  });

  it('loads and caches the authoritative Field organization', async () => {
    mockFetcher.mockResolvedValue(mockRow);
    await expect(loadFieldOrganizationProfile(mockFetcher, { force: true })).resolves.toMatchObject({ organizationName: 'LARAISE' });
    expect(localStorage.getItem('surfjudging_field_organization_profile')).toContain('LARAISE');
  });

  it('makes the Field organization authoritative for official PDFs', async () => {
    mockFetcher.mockResolvedValue(mockRow);
    await expect(resolvePdfOrganizationIdentity(mockFetcher, { organizer: 'Ancien organisateur' })).resolves.toEqual({
      organizer: 'LARAISE',
      organizerLogoDataUrl: 'data:image/png;base64,AAAA',
    });
  });
});
