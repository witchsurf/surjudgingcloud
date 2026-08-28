export type FieldRuntimeConfig = {
  anonKey?: string;
};

declare global {
  interface Window {
    __SURFJUDGING_RUNTIME_CONFIG__?: FieldRuntimeConfig;
  }
}

export function getFieldRuntimeAnonKey(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = window.__SURFJUDGING_RUNTIME_CONFIG__?.anonKey;
  if (typeof candidate !== 'string') return undefined;
  const normalized = candidate.trim();
  return normalized.length >= 32 ? normalized : undefined;
}

