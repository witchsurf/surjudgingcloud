/**
 * Centralized Local Network Detection
 *
 * Consolidates the duplicated hostname-based LAN detection into a single utility.
 * Supports: RFC1918, localhost, mDNS (.local), IPv6 link-local, and custom hostnames.
 */

/**
 * Returns true if the given hostname (or the current browser hostname) belongs
 * to a local / LAN network, including:
 *
 * - `localhost` / `127.0.0.1`
 * - RFC 1918 private ranges: `10.*`, `172.16-31.*`, `192.168.*`
 * - mDNS / Bonjour / Avahi: `*.local`
 * - IPv6 link-local: addresses starting with `fe80:` or `[fe80:`
 * - Custom hostnames declared via `VITE_LOCAL_HOSTNAMES` (comma-separated)
 */
export function isLocalNetworkHost(hostname?: string): boolean {
  const h = (
    hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  )
    .trim()
    .toLowerCase();

  if (!h) return false;

  // Exact matches
  if (h === 'localhost' || h === '127.0.0.1') return true;

  // RFC 1918 private ranges
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h.startsWith('172.')) {
    // 172.16.0.0 – 172.31.255.255
    const secondOctet = parseInt(h.split('.')[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  // mDNS / Bonjour / Avahi (e.g. surfjudging-box.local)
  if (h.endsWith('.local')) return true;

  // IPv6 link-local (with or without brackets)
  if (h.startsWith('fe80:') || h.startsWith('[fe80:')) return true;

  // Custom hostnames from env (e.g. VITE_LOCAL_HOSTNAMES="hp-box,beach-router")
  try {
    const custom = (import.meta as { env?: Record<string, string> }).env?.VITE_LOCAL_HOSTNAMES;
    if (custom) {
      const entries = custom.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (entries.includes(h)) return true;
    }
  } catch {
    // env may not be available in all contexts
  }

  return false;
}

/**
 * Checks whether a URL string points to a local network endpoint.
 * Useful for fallback detection when only a URL is available (e.g. Supabase URL).
 */
export function isLocalNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isLocalNetworkHost(parsed.hostname);
  } catch {
    // Not a valid URL — apply simple heuristic matching
    return (
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      /\b192\.168\.\d/.test(url) ||
      /\b10\.\d/.test(url) ||
      /\b172\.(1[6-9]|2\d|3[01])\./.test(url) ||
      url.includes('.local') ||
      url.includes(':8000') ||
      url.includes(':8080')
    );
  }
}
