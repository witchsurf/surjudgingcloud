import { isLocalNetworkUrl } from './networkDetection';

export const FIELD_ROUTES = {
  chief: '/admin',
  chiefLegacy: '/chief-judge',
  judge: '/judge',
  priority: '/priority',
  display: '/display',
} as const;

export interface FieldNetworkInfo {
  hostname: string;
  frontendPort: string;
  frontendOrigin: string;
  supabaseUrl: string;
  chiefUrl: string;
  chiefLegacyUrl: string;
  judgeUrl: string;
  priorityUrl: string;
  displayUrl: string;
  esp32Url: string;
}

type LocationLike = Pick<Location, 'protocol' | 'hostname' | 'port' | 'origin'>;

const normalizeOrigin = (location: LocationLike): string => {
  if (location.origin && location.origin !== 'null') return location.origin.replace(/\/$/, '');
  const port = location.port ? `:${location.port}` : '';
  return `${location.protocol}//${location.hostname}${port}`;
};

export function buildFieldNetworkInfo(
  location: LocationLike,
  configuredSupabaseUrl: string,
  esp32Url = 'http://priority.local',
): FieldNetworkInfo {
  const frontendOrigin = normalizeOrigin(location);
  const supabaseUrl = configuredSupabaseUrl.replace(/\/$/, '');
  const routeUrl = (route: string) => `${frontendOrigin}${route}`;

  return {
    hostname: location.hostname,
    frontendPort: location.port || (location.protocol === 'https:' ? '443' : '80'),
    frontendOrigin,
    supabaseUrl,
    chiefUrl: routeUrl(FIELD_ROUTES.chief),
    chiefLegacyUrl: routeUrl(FIELD_ROUTES.chiefLegacy),
    judgeUrl: routeUrl(FIELD_ROUTES.judge),
    priorityUrl: routeUrl(FIELD_ROUTES.priority),
    displayUrl: routeUrl(FIELD_ROUTES.display),
    esp32Url: esp32Url.replace(/\/$/, ''),
  };
}

export function isAllowedFieldNetworkUrl(
  input: string,
  frontendOrigin: string,
  configuredSupabaseUrl: string,
): boolean {
  if (/^(?:data|blob|about):/i.test(input)) return true;

  try {
    const url = new URL(input, frontendOrigin);
    const frontend = new URL(frontendOrigin);
    if (url.origin === frontend.origin) return true;
    if (url.hostname.toLowerCase() === 'priority.local') return true;
    const host = url.hostname.toLowerCase();
    const octets = host.split('.').map(Number);
    const isPrivateIp = octets.length === 4
      && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && (octets[0] === 10
        || octets[0] === 127
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168));
    if (host === 'localhost' || host === '[::1]' || isPrivateIp) return true;
    if (configuredSupabaseUrl) {
      const supabase = new URL(configuredSupabaseUrl);
      if (isLocalNetworkUrl(supabase.href) && url.origin === supabase.origin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function probeEsp32(
  esp32Url = 'http://priority.local',
  timeoutMs = 1500,
): Promise<{ reachable: boolean; error: string | null }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(esp32Url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return { reachable: true, error: null };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'ESP32 inaccessible',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
