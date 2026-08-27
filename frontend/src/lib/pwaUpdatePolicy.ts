const SAFE_AUTOMATIC_UPDATE_PATHS = new Set(['/', '/landing']);

const normalizePathname = (pathname: string): string => {
  const normalized = `/${String(pathname || '').replace(/^\/+|\/+$/g, '')}`;
  return normalized === '//' ? '/' : normalized;
};

/**
 * Operational pages must never be reloaded by a service-worker activation.
 * A waiting release is applied after navigation to a passive landing page or
 * when every tab is closed and the browser activates it naturally.
 */
export const shouldAutoApplyPwaUpdate = (pathname: string): boolean =>
  SAFE_AUTOMATIC_UPDATE_PATHS.has(normalizePathname(pathname));
