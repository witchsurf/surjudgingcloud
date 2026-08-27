import { describe, expect, it } from 'vitest';
import type { HeatEntriesWithParticipantRow } from '../../api/modules/heats.api';
import { reconcileLineupDrafts } from '../AdminInterface';

const entry = (position: number, participantId: number, name: string): HeatEntriesWithParticipantRow => ({
  id: participantId,
  heat_id: 'next-heat',
  participant_id: participantId,
  position,
  seed: position,
  color: position === 1 ? 'RED' : 'WHITE',
  participant: {
    id: participantId,
    event_id: 7,
    category: 'CADET',
    seed: position,
    name,
    country: 'SN',
    license: null,
    created_at: null,
    updated_at: null,
  },
});

describe('AdminInterface lineup override drafts', () => {
  it('replaces stale drafts when the selected heat changes', () => {
    const result = reconcileLineupDrafts({
      1: { participantId: '1', manualName: 'Ancien rouge', country: 'XX', reason: 'brouillon' },
      2: { participantId: '2', manualName: 'Ancien blanc', country: 'XX', reason: 'brouillon' },
    }, 'previous-heat', 'next-heat', [entry(1, 11, 'Nouveau rouge'), entry(2, 12, 'Nouveau blanc')]);

    expect(result).toEqual({
      1: { participantId: '11', manualName: 'Nouveau rouge', country: 'SN', reason: '' },
      2: { participantId: '12', manualName: 'Nouveau blanc', country: 'SN', reason: '' },
    });
  });

  it('preserves an operator draft while the same heat refreshes', () => {
    const draft = { participantId: '', manualName: 'Correction en cours', country: 'SN', reason: 'Annonce' };
    const result = reconcileLineupDrafts({ 1: draft }, 'same-heat', 'same-heat', [entry(1, 11, 'Nom DB')]);
    expect(result[1]).toEqual(draft);
  });
});
