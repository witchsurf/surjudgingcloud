import { describe, expect, it } from 'vitest';
import { isAnyHeatCloseRpcUnavailable, isStrictHeatCloseRpcUnavailable } from '../heatCloseErrors';

describe('heat close RPC availability classification', () => {
  it.each([
    { code: 'PGRST202', message: 'schema cache miss' },
    { code: '42883', message: 'undefined function' },
    { message: 'Could not find close_heat_on_podium_strict in the schema cache' },
  ])('accepts only genuine strict RPC absence', (error) => {
    expect(isStrictHeatCloseRpcUnavailable(error)).toBe(true);
  });

  it.each([
    { code: '42501', message: 'permission denied for function close_heat_on_podium_strict' },
    { code: '23514', message: 'HEAT_CLOSE_BLOCKED close_heat_on_podium_strict' },
    { code: '23503', message: 'Heat does not belong to event' },
  ])('rejects real strict RPC errors', (error) => {
    expect(isStrictHeatCloseRpcUnavailable(error)).toBe(false);
    expect(isAnyHeatCloseRpcUnavailable(error)).toBe(false);
  });

  it('recognizes genuine legacy RPC absence for the outer compatibility fallback', () => {
    expect(isAnyHeatCloseRpcUnavailable({
      code: 'PGRST202', message: 'Could not find close_heat_on_podium in schema cache',
    })).toBe(true);
  });
});
