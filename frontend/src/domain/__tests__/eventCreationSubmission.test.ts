import { describe, expect, it } from 'vitest';
import {
  resolveEventCreationSubmission,
  validateEventCreationSubmission,
} from '../eventCreationSubmission';

const nativeValues = (values: Record<string, string>) => ({
  get: (key: string) => values[key] ?? null,
});

describe('event creation submission', () => {
  it('uses the native form dates when browser date state lags behind React state', () => {
    const submission = resolveEventCreationSubmission(nativeValues({
      name: ' Competition X ',
      organizer: ' Surf Sénégal ',
      startDate: '2026-08-27',
      endDate: '2026-08-27',
    }), {
      name: 'stale name',
      organizer: 'stale organizer',
      startDate: '',
      endDate: '',
    });

    expect(submission).toEqual({
      name: 'Competition X',
      organizer: 'Surf Sénégal',
      startDate: '2026-08-27',
      endDate: '2026-08-27',
    });
    expect(validateEventCreationSubmission(submission)).toBeNull();
  });

  it('rejects missing dates before the repository call', () => {
    expect(validateEventCreationSubmission({
      name: 'Competition X',
      organizer: 'Surf Sénégal',
      startDate: '',
      endDate: '',
    })).toBe('Les dates de début et de fin sont requises.');
  });

  it('rejects an inverted date range', () => {
    expect(validateEventCreationSubmission({
      name: 'Competition X',
      organizer: 'Surf Sénégal',
      startDate: '2026-08-28',
      endDate: '2026-08-27',
    })).toBe('La date de fin doit être postérieure ou égale à la date de début.');
  });
});
