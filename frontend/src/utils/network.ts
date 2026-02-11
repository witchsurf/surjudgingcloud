export const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost') return true;

  // Basic IPv4 private range detection
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  return false;
};
