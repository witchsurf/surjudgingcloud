import type { PanelContext } from './panelContext';

export type RuntimePanelSnapshots = ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>>;

export type PanelContextLoader = (
  heatIds: readonly string[],
  runtimeSnapshots?: RuntimePanelSnapshots,
) => Promise<ReadonlyMap<string, PanelContext>>;

const resolvedCache = new Map<string, PanelContext>();
const pendingCache = new Map<string, Promise<PanelContext>>();

const snapshotFor = (snapshots: RuntimePanelSnapshots | undefined, heatId: string) => {
  if (!snapshots) return undefined;
  return snapshots instanceof Map ? snapshots.get(heatId) : snapshots[heatId];
};

const cacheKey = (heatId: string, snapshot?: readonly string[]) =>
  `${heatId}::${(snapshot || []).map((station) => station.trim().toUpperCase()).join(',')}`;

export async function getCachedPanelContexts(
  heatIds: readonly string[],
  runtimeSnapshots?: RuntimePanelSnapshots,
  loader: PanelContextLoader,
): Promise<Map<string, PanelContext>> {
  const uniqueIds = Array.from(new Set(heatIds.filter(Boolean)));
  const result = new Map<string, PanelContext>();
  const missing: string[] = [];

  uniqueIds.forEach((heatId) => {
    const key = cacheKey(heatId, snapshotFor(runtimeSnapshots, heatId));
    const cached = resolvedCache.get(key);
    if (cached) result.set(heatId, cached);
    else if (!pendingCache.has(key)) missing.push(heatId);
  });

  if (missing.length > 0) {
    const batchPromise = loader(missing, runtimeSnapshots);
    missing.forEach((heatId) => {
      const key = cacheKey(heatId, snapshotFor(runtimeSnapshots, heatId));
      const itemPromise = batchPromise.then((contexts) => {
        const context = contexts.get(heatId) || {
          judgeCount: null,
          source: 'unknown' as const,
          issue: 'panel_unknown' as const,
          message: 'Panel inconnu : aucune résolution retournée.',
        };
        // A transient read failure must remain retryable after a heat/config change.
        if (context.issue !== 'network_error') resolvedCache.set(key, context);
        pendingCache.delete(key);
        return context;
      }, (error) => {
        pendingCache.delete(key);
        throw error;
      });
      pendingCache.set(key, itemPromise);
    });
  }

  await Promise.all(uniqueIds.map(async (heatId) => {
    if (result.has(heatId)) return;
    const key = cacheKey(heatId, snapshotFor(runtimeSnapshots, heatId));
    const context = resolvedCache.get(key) || await pendingCache.get(key);
    if (context) result.set(heatId, context);
  }));

  return result;
}

export function clearPanelContextCache(): void {
  resolvedCache.clear();
  pendingCache.clear();
}
