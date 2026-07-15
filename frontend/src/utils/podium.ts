export const DEFAULT_PODIUM_ID = 'A';

export function normalizePodiumId(value?: string | null): string {
    const normalized = (value || DEFAULT_PODIUM_ID).trim().toUpperCase();
    return normalized || DEFAULT_PODIUM_ID;
}

export function getPodiumIdFromSearch(search: string): string {
    return normalizePodiumId(new URLSearchParams(search).get('podium'));
}
