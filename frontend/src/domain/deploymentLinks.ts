export type InternalAccessRoute = '/display' | '/judge' | '/priority';

export type AccessLinkParams = Record<string, string | number | null | undefined>;

export const buildDeploymentAwareUrl = (
  origin: string,
  route: InternalAccessRoute,
  params: AccessLinkParams = {},
): string => {
  const url = new URL(route, new URL(origin).origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

type QrEncoder = (
  value: string,
  options: {
    width: number;
    margin: number;
    color: { dark: string; light: string };
  },
) => Promise<string>;

export const encodeDeploymentAwareQr = (
  value: string,
  darkColor: string,
  encoder: QrEncoder,
): Promise<string> => encoder(value, {
  width: 220,
  margin: 1,
  color: {
    dark: darkColor,
    light: '#ffffff',
  },
});
