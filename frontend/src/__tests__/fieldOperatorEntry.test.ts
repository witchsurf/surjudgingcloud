import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Field operator entry contract', () => {
  it('keeps both local operator actions on the landing page', () => {
    const landing = source('src/components/LandingPage.tsx');
    expect(landing).toContain('Organiser un événement');
    expect(landing).toContain("navigate('/create-event?fresh=1')");
    expect(landing).toContain('Mes événements');
    expect(landing).toContain("navigate('/my-events')");
  });

  it('creates Field events through the repository without Cloud payment', () => {
    const createEvent = source('src/components/CreateEvent.tsx');
    expect(createEvent).toContain('await eventRepository.create');
    expect(createEvent).toContain("deploymentMode === 'cloud'");
    expect(createEvent).toContain('`/participants?eventId=${canonicalId}');
  });

  it('reads Field My Events from the configured local database without owner filter', () => {
    const myEvents = source('src/pages/MyEvents.tsx');
    expect(myEvents).toContain("deploymentMode === 'field'");
    expect(myEvents).toContain(".from('events')");
    expect(myEvents).toContain("deploymentMode === 'cloud'");
    expect(myEvents).toContain('fieldOrganization?.organizationName || user.email');
    expect(myEvents).toContain('fieldOrganization.logoDataUrl');
  });

  it('uses the same Field organization as the default event and PDF identity', () => {
    const createEvent = source('src/components/CreateEvent.tsx');
    const pdfExport = source('src/utils/pdfExport.ts');
    expect(createEvent).toContain('profile.organizationName');
    expect(createEvent).toContain('profile.logoDataUrl');
    expect(pdfExport).toContain('resolvePdfOrganizationIdentity');
  });
});
