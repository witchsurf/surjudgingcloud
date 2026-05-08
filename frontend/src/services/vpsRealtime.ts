import type { AppConfig, HeatTimer } from '../types';

// Optional VPS relay integration.
// In most deployments this stays unused; keeping a typed stub avoids TS build breaks
// when hybrid mode code-paths are compiled but not configured.

type HeatUpdateListener = (timer: HeatTimer, config: AppConfig | null, status: unknown) => void;

let connected = false;

export function initializeVpsSync(_url: string, _apiKey: string) {
  connected = false;
}

export function isVpsConnected() {
  return connected;
}

export function subscribeToVpsEvents(_heatId: string, _onUpdate: HeatUpdateListener) {
  return () => {};
}

