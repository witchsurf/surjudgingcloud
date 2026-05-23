/**
 * IndexedDB Offline Store
 *
 * Provides high-capacity, persistent storage for the offline WAL (Write-Ahead Log)
 * and the legacy offline queue. Replaces localStorage to avoid the ~5 MB browser
 * limit that can cause data loss during beach events.
 *
 * Falls back to localStorage automatically if IndexedDB is unavailable
 * (e.g. Safari Private Browsing mode).
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { OfflineMutation } from '../stores/offlineStore';

// ──────────────────────────────────────────────────────────────
// Database configuration
// ──────────────────────────────────────────────────────────────

const DB_NAME = 'SurfJudging';
const DB_VERSION = 2; // Bumped from 1 to add offline queue stores
const WAL_STORE = 'offline_wal';
const LEGACY_STORE = 'legacy_queue';

// localStorage keys (used for migration & fallback)
const LS_WAL_KEY = 'surfJudgingOfflineWAL';
const LS_LEGACY_KEY = 'surfapp_offline_queue';

let dbInstance: IDBPDatabase | null = null;
let idbAvailable: boolean | null = null;
let migrationDone = false;

// ──────────────────────────────────────────────────────────────
// IDB availability check (shared with idbStorage.ts)
// ──────────────────────────────────────────────────────────────

async function checkIDBAvailability(): Promise<boolean> {
  if (idbAvailable !== null) return idbAvailable;
  try {
    const testDb = await openDB('__idb_offline_test__', 1, {
      upgrade(db) {
        db.createObjectStore('test');
      },
    });
    testDb.close();
    const delReq = indexedDB.deleteDatabase('__idb_offline_test__');
    await new Promise<void>((resolve) => {
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => resolve();
    });
    idbAvailable = true;
  } catch {
    console.warn('⚠️ IndexedDB not available for offline store, falling back to localStorage');
    idbAvailable = false;
  }
  return idbAvailable;
}

// ──────────────────────────────────────────────────────────────
// Database access
// ──────────────────────────────────────────────────────────────

async function getDB(): Promise<IDBPDatabase | null> {
  if (!(await checkIDBAvailability())) return null;
  if (dbInstance) return dbInstance;

  try {
    dbInstance = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // V1 stores (scores) – created by idbStorage.ts
        if (!db.objectStoreNames.contains('scores')) {
          const scoresStore = db.createObjectStore('scores', { keyPath: 'id' });
          scoresStore.createIndex('by-heat', 'heat_id');
          scoresStore.createIndex('by-synced', 'synced');
        }

        // V2 stores – offline queues
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(WAL_STORE)) {
            db.createObjectStore(WAL_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(LEGACY_STORE)) {
            db.createObjectStore(LEGACY_STORE, { autoIncrement: true });
          }
        }
      },
    });

    // One-time migration from localStorage
    if (!migrationDone) {
      migrationDone = true;
      await migrateLocalStorageQueues(dbInstance);
    }

    return dbInstance;
  } catch (error) {
    console.warn('⚠️ Failed to open IndexedDB for offline store:', error);
    idbAvailable = false;
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Migration from localStorage → IndexedDB
// ──────────────────────────────────────────────────────────────

async function migrateLocalStorageQueues(db: IDBPDatabase): Promise<void> {
  // Migrate WAL mutations
  try {
    const walRaw = localStorage.getItem(LS_WAL_KEY);
    if (walRaw) {
      const parsed = JSON.parse(walRaw);
      const mutations: OfflineMutation[] = parsed?.state?.mutations ?? parsed?.mutations ?? [];
      if (Array.isArray(mutations) && mutations.length > 0) {
        console.log(`📦 Migrating ${mutations.length} WAL mutations from localStorage to IndexedDB...`);
        const tx = db.transaction(WAL_STORE, 'readwrite');
        await Promise.all([
          ...mutations.map((m) => tx.store.put(m)),
          tx.done,
        ]);
        localStorage.removeItem(LS_WAL_KEY);
        console.log('✅ WAL migration complete.');
      }
    }
  } catch (error) {
    console.warn('⚠️ WAL migration failed (data preserved in localStorage):', error);
  }

  // Migrate legacy queue
  try {
    const legacyRaw = localStorage.getItem(LS_LEGACY_KEY);
    if (legacyRaw) {
      const entries = JSON.parse(legacyRaw);
      if (Array.isArray(entries) && entries.length > 0) {
        console.log(`📦 Migrating ${entries.length} legacy queue entries from localStorage to IndexedDB...`);
        const tx = db.transaction(LEGACY_STORE, 'readwrite');
        await Promise.all([
          ...entries.map((e: unknown) => tx.store.add(e)),
          tx.done,
        ]);
        localStorage.removeItem(LS_LEGACY_KEY);
        console.log('✅ Legacy queue migration complete.');
      }
    }
  } catch (error) {
    console.warn('⚠️ Legacy queue migration failed (data preserved in localStorage):', error);
  }
}

// ──────────────────────────────────────────────────────────────
// WAL (Zustand offlineStore) – Public API
// ──────────────────────────────────────────────────────────────

export async function walGetAll(): Promise<OfflineMutation[]> {
  const db = await getDB();
  if (db) {
    try {
      return (await db.getAll(WAL_STORE)) as OfflineMutation[];
    } catch (error) {
      console.warn('⚠️ IDB walGetAll failed, falling back to localStorage:', error);
    }
  }
  return walLsFallbackRead();
}

export async function walPut(mutation: OfflineMutation): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      await db.put(WAL_STORE, mutation);
      return;
    } catch (error) {
      console.warn('⚠️ IDB walPut failed, falling back to localStorage:', error);
    }
  }
  walLsFallbackAppend(mutation);
}

export async function walPutAll(mutations: OfflineMutation[]): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      const tx = db.transaction(WAL_STORE, 'readwrite');
      await Promise.all([
        ...mutations.map((m) => tx.store.put(m)),
        tx.done,
      ]);
      return;
    } catch (error) {
      console.warn('⚠️ IDB walPutAll failed, falling back to localStorage:', error);
    }
  }
  walLsFallbackWrite(mutations);
}

export async function walRemove(id: string): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      await db.delete(WAL_STORE, id);
      return;
    } catch (error) {
      console.warn('⚠️ IDB walRemove failed, falling back to localStorage:', error);
    }
  }
  const items = walLsFallbackRead();
  walLsFallbackWrite(items.filter((m) => m.id !== id));
}

export async function walClear(): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      await db.clear(WAL_STORE);
      return;
    } catch (error) {
      console.warn('⚠️ IDB walClear failed, falling back to localStorage:', error);
    }
  }
  walLsFallbackWrite([]);
}

// ──────────────────────────────────────────────────────────────
// Legacy queue (surfapp_offline_queue) – Public API
// ──────────────────────────────────────────────────────────────

export interface LegacyOfflineEntry {
  operation_id?: string;
  queued_at?: string;
  table: string;
  action: 'insert' | 'update' | 'delete' | 'upsert';
  payload: any;
  timestamp: number;
}

export async function legacyGetAll(): Promise<LegacyOfflineEntry[]> {
  const db = await getDB();
  if (db) {
    try {
      return (await db.getAll(LEGACY_STORE)) as LegacyOfflineEntry[];
    } catch (error) {
      console.warn('⚠️ IDB legacyGetAll failed, falling back to localStorage:', error);
    }
  }
  return legacyLsFallbackRead();
}

export async function legacyAdd(entry: LegacyOfflineEntry): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      await db.add(LEGACY_STORE, entry);
      return;
    } catch (error) {
      console.warn('⚠️ IDB legacyAdd failed, falling back to localStorage:', error);
    }
  }
  legacyLsFallbackAppend(entry);
}

export async function legacySetAll(entries: LegacyOfflineEntry[]): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      const tx = db.transaction(LEGACY_STORE, 'readwrite');
      await tx.store.clear();
      await Promise.all([
        ...entries.map((e) => tx.store.add(e)),
        tx.done,
      ]);
      return;
    } catch (error) {
      console.warn('⚠️ IDB legacySetAll failed, falling back to localStorage:', error);
    }
  }
  legacyLsFallbackWrite(entries);
}

export async function legacyClear(): Promise<void> {
  const db = await getDB();
  if (db) {
    try {
      await db.clear(LEGACY_STORE);
      return;
    } catch (error) {
      console.warn('⚠️ IDB legacyClear failed, falling back to localStorage:', error);
    }
  }
  legacyLsFallbackWrite([]);
}

// ──────────────────────────────────────────────────────────────
// localStorage fallback helpers
// ──────────────────────────────────────────────────────────────

function walLsFallbackRead(): OfflineMutation[] {
  try {
    const raw = localStorage.getItem(LS_WAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed?.state?.mutations ?? parsed?.mutations ?? [];
  } catch {
    return [];
  }
}

function walLsFallbackWrite(mutations: OfflineMutation[]): void {
  try {
    // Zustand persist format: { state: { mutations: [...] }, version: 0 }
    localStorage.setItem(LS_WAL_KEY, JSON.stringify({ state: { mutations }, version: 0 }));
  } catch (error) {
    console.warn('⚠️ localStorage WAL write failed (quota?):', error);
  }
}

function walLsFallbackAppend(mutation: OfflineMutation): void {
  const existing = walLsFallbackRead();
  existing.push(mutation);
  walLsFallbackWrite(existing);
}

function legacyLsFallbackRead(): LegacyOfflineEntry[] {
  try {
    const raw = localStorage.getItem(LS_LEGACY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function legacyLsFallbackWrite(entries: LegacyOfflineEntry[]): void {
  try {
    localStorage.setItem(LS_LEGACY_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('⚠️ localStorage legacy queue write failed (quota?):', error);
  }
}

function legacyLsFallbackAppend(entry: LegacyOfflineEntry): void {
  const existing = legacyLsFallbackRead();
  existing.push(entry);
  legacyLsFallbackWrite(existing);
}

// ──────────────────────────────────────────────────────────────
// Zustand Storage Adapter
// ──────────────────────────────────────────────────────────────

/**
 * Creates a Zustand-compatible `StateStorage` adapter that stores data in
 * IndexedDB via the WAL store, falling back to localStorage.
 *
 * Usage in offlineStore.ts:
 * ```ts
 * import { createIDBZustandStorage } from './idbOfflineStore';
 * persist(storeCreator, { storage: createIDBZustandStorage() })
 * ```
 */
export function createIDBZustandStorage() {
  return {
    getItem: async (name: string): Promise<string | null> => {
      // If this is the WAL key, read from IDB
      if (name === LS_WAL_KEY) {
        const mutations = await walGetAll();
        return JSON.stringify({ state: { mutations }, version: 0 });
      }
      // Fallback for any other key
      return localStorage.getItem(name);
    },

    setItem: async (name: string, value: string): Promise<void> => {
      if (name === LS_WAL_KEY) {
        try {
          const parsed = JSON.parse(value);
          const mutations: OfflineMutation[] = parsed?.state?.mutations ?? [];
          await walPutAll(mutations);
        } catch (error) {
          console.warn('⚠️ IDB Zustand setItem failed, falling back:', error);
          localStorage.setItem(name, value);
        }
        return;
      }
      localStorage.setItem(name, value);
    },

    removeItem: async (name: string): Promise<void> => {
      if (name === LS_WAL_KEY) {
        await walClear();
        return;
      }
      localStorage.removeItem(name);
    },
  };
}
