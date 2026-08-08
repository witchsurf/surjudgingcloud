export const isStrictHeatCloseRpcUnavailable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code || '').toUpperCase();
  const message = String(candidate.message || '');
  return code === 'PGRST202'
    || code === '42883'
    || (
      /close_heat_on_podium_strict/i.test(message)
      && /schema cache|could not find|does not exist|function.*not found/i.test(message)
    );
};

export const isAnyHeatCloseRpcUnavailable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code || '').toUpperCase();
  const message = String(candidate.message || '');
  return code === 'PGRST202'
    || code === '42883'
    || (
      /close_heat_on_podium(?:_strict)?/i.test(message)
      && /schema cache|could not find|does not exist|function.*not found/i.test(message)
    );
};
