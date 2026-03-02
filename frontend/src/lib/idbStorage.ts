/**
 * IndexedDB Storage Layer
 *
 * Provides persistent, high-capacity storage for scores using IndexedDB.
 * Falls back to localStorage if IndexedDB is unavailable (e.g. Safari Private Mode).
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { Score } from '../types';

const DB_NAME = 'SurfJudging';
const DB_VERSION = 1;
const SCORES_STORE = 'scores';

// Fallback key for localStorage
const LS_FALLBACK_KEY = 'surfJudgingScores';

let dbInstance: IDBPDatabase | null = null;
let idbAvailable: boolean | null = null;

/**
 * Check if IndexedDB is available in this environment
 */
async function checkIDBAvailability(): Promise<boolean> {
    if (idbAvailable !== null) return idbAvailable;
    try {
        const testDb = await openDB('__idb_test__', 1, {
            upgrade(db) {
                db.createObjectStore('test');
            },
        });
        testDb.close();
        // Clean up test DB
        const delReq = indexedDB.deleteDatabase('__idb_test__');
        await new Promise<void>((resolve) => {
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => resolve();
        });
        idbAvailable = true;
    } catch {
        console.warn('⚠️ IndexedDB not available, falling back to localStorage');
        idbAvailable = false;
    }
    return idbAvailable;
}

/**
 * Get or create the IndexedDB instance
 */
async function getDB(): Promise<IDBPDatabase | null> {
    if (!(await checkIDBAvailability())) return null;
    if (dbInstance) return dbInstance;

    try {
        dbInstance = await openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(SCORES_STORE)) {
                    const store = db.createObjectStore(SCORES_STORE, { keyPath: 'id' });
                    store.createIndex('by-heat', 'heat_id');
                    store.createIndex('by-synced', 'synced');
                }
            },
        });
        return dbInstance;
    } catch (error) {
        console.warn('⚠️ Failed to open IndexedDB:', error);
        idbAvailable = false;
        return null;
    }
}

// ==================== localStorage fallback helpers ====================

function lsRead(): Score[] {
    try {
        const raw = localStorage.getItem(LS_FALLBACK_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function lsWrite(scores: Score[]): void {
    try {
        localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(scores));
    } catch (error) {
        console.warn('⚠️ localStorage write failed (quota?):', error);
    }
}

// ==================== Public API ====================

/**
 * Save or update a single score
 */
export async function saveScoreIDB(score: Score): Promise<void> {
    // Always write to localStorage as fallback/cache
    const ls = lsRead();
    const idx = ls.findIndex(s => s.id === score.id);
    if (idx >= 0) ls[idx] = score;
    else ls.push(score);
    lsWrite(ls);

    // Write to IndexedDB
    const db = await getDB();
    if (db) {
        try {
            await db.put(SCORES_STORE, score);
        } catch (error) {
            console.warn('⚠️ IDB put failed:', error);
        }
    }
}

/**
 * Save multiple scores at once (batch)
 */
export async function saveScoresBatchIDB(scores: Score[]): Promise<void> {
    // localStorage sync
    const ls = lsRead();
    const lsMap = new Map(ls.map(s => [s.id, s]));
    scores.forEach(s => lsMap.set(s.id, s));
    lsWrite(Array.from(lsMap.values()));

    // IndexedDB batch
    const db = await getDB();
    if (db) {
        try {
            const tx = db.transaction(SCORES_STORE, 'readwrite');
            await Promise.all([
                ...scores.map(s => tx.store.put(s)),
                tx.done
            ]);
        } catch (error) {
            console.warn('⚠️ IDB batch put failed:', error);
        }
    }
}

/**
 * Get all scores for a specific heat
 */
export async function getScoresByHeatIDB(heatIds: string[]): Promise<Score[]> {
    const db = await getDB();
    if (db) {
        try {
            const results: Score[] = [];
            for (const heatId of heatIds) {
                const scores = await db.getAllFromIndex(SCORES_STORE, 'by-heat', heatId);
                results.push(...(scores as Score[]));
            }
            return results;
        } catch (error) {
            console.warn('⚠️ IDB read failed, falling back to localStorage:', error);
        }
    }

    // Fallback
    return lsRead().filter(s => heatIds.includes(s.heat_id));
}

/**
 * Get all unsynced scores
 */
export async function getUnsyncedScoresIDB(): Promise<Score[]> {
    const db = await getDB();
    if (db) {
        try {
            return (await db.getAllFromIndex(SCORES_STORE, 'by-synced', false)) as Score[];
        } catch (error) {
            console.warn('⚠️ IDB unsynced query failed:', error);
        }
    }
    return lsRead().filter(s => s.synced === false);
}

/**
 * Mark scores as synced by their IDs
 */
export async function markScoresSyncedIDB(ids: string[]): Promise<void> {
    // localStorage
    const ls = lsRead();
    const idSet = new Set(ids);
    const updated = ls.map(s => idSet.has(s.id) ? { ...s, synced: true } : s);
    lsWrite(updated);

    // IndexedDB
    const db = await getDB();
    if (db) {
        try {
            const tx = db.transaction(SCORES_STORE, 'readwrite');
            for (const id of ids) {
                const score = await tx.store.get(id);
                if (score) {
                    score.synced = true;
                    await tx.store.put(score);
                }
            }
            await tx.done;
        } catch (error) {
            console.warn('⚠️ IDB markSynced failed:', error);
        }
    }
}

/**
 * Get ALL scores from storage
 */
export async function getAllScoresIDB(): Promise<Score[]> {
    const db = await getDB();
    if (db) {
        try {
            return (await db.getAll(SCORES_STORE)) as Score[];
        } catch (error) {
            console.warn('⚠️ IDB getAll failed:', error);
        }
    }
    return lsRead();
}

/**
 * Update a score at a specific index (for overrides)
 */
export async function updateScoreIDB(score: Score): Promise<void> {
    await saveScoreIDB(score);
}
