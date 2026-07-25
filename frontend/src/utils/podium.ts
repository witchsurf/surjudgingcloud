export const DEFAULT_PODIUM_ID = 'A';

export function normalizePodiumId(value?: string | null): string {
    const normalized = (value || DEFAULT_PODIUM_ID).trim().toUpperCase();
    return normalized || DEFAULT_PODIUM_ID;
}

export function getPodiumIdFromSearch(search: string): string {
    return normalizePodiumId(new URLSearchParams(search).get('podium'));
}

export function shouldPreferActivePointer(
    podiumIdInput: string | null | undefined,
    snapshotUpdatedAt?: string | null,
    pointerUpdatedAt?: string | null,
): boolean {
    const podiumId = normalizePodiumId(podiumIdInput);

    // Podiums other than A do not own event_last_config. Their explicit pointer
    // is therefore authoritative, even when podium A updated the global snapshot
    // more recently.
    if (podiumId !== DEFAULT_PODIUM_ID) return true;

    const snapshotTimestamp = snapshotUpdatedAt ? Date.parse(snapshotUpdatedAt) : NaN;
    const pointerTimestamp = pointerUpdatedAt ? Date.parse(pointerUpdatedAt) : NaN;
    return Number.isFinite(pointerTimestamp)
        && (!Number.isFinite(snapshotTimestamp) || pointerTimestamp >= snapshotTimestamp);
}
