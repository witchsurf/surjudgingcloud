import { describe, expect, it } from 'vitest';
import { resolveFieldEventContextRedirect } from '../FieldEventContextGuard';

describe('Field operator event entry', () => {
  it.each([null, '', 'nope', '0', '-1', '1.5'])(
    'redirects invalid Field eventId %s to My Events',
    (eventId) => expect(resolveFieldEventContextRedirect('field', eventId)).toBe('/my-events'),
  );

  it.each(['1', '28', '9007199254740991'])(
    'keeps valid Field eventId %s',
    (eventId) => expect(resolveFieldEventContextRedirect('field', eventId)).toBeNull(),
  );

  it.each([null, '', 'nope', '0', '28'])(
    'does not change Cloud eventId %s',
    (eventId) => expect(resolveFieldEventContextRedirect('cloud', eventId)).toBeNull(),
  );
});
