/**
 * Secure localStorage wrapper with expiration and basic obfuscation
 * Prevents stale data and adds a layer of security for sensitive information
 */

interface StorageItem<T> {
  value: T;
  timestamp: number;
  expiresAt?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[kind] ?? null;
  } catch {
    // Safari privacy contexts, replay sandboxes and hardened browsers may expose
    // window while denying access to Web Storage. Cache storage is non-critical.
    return null;
  }
}

export const getSafeLocalStorage = (): Storage | null => getBrowserStorage('localStorage');

export const getSafeSessionStorage = (): Storage | null => getBrowserStorage('sessionStorage');

/**
 * Basic obfuscation using base64 (NOT encryption, just prevents casual inspection)
 * For true security, use Web Crypto API for actual encryption
 */
function obfuscate(data: string): string {
  try {
    return btoa(encodeURIComponent(data));
  } catch {
    return data; // Fallback if btoa fails
  }
}

function deobfuscate(data: string): string {
  try {
    return decodeURIComponent(atob(data));
  } catch {
    return data; // Fallback if atob fails
  }
}

/**
 * Securely set an item in localStorage with optional expiration
 */
export function secureSetItem<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return;
  try {
    const item: StorageItem<T> = {
      value,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    const serialized = JSON.stringify(item);
    const obfuscated = obfuscate(serialized);
    storage.setItem(key, obfuscated);
  } catch (error) {
    console.error(`Failed to set secure item ${key}:`, error);
    // Fallback to regular storage if obfuscation fails
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      // Silent fail if localStorage is full or unavailable
    }
  }
}

/**
 * Securely get an item from localStorage with expiration check
 */
export function secureGetItem<T>(key: string): T | null {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return null;
  try {
    const stored = storage.getItem(key);
    if (!stored) {
      return null;
    }

    // Try to parse as secure item
    try {
      const deobfuscated = deobfuscate(stored);
      const item = JSON.parse(deobfuscated) as StorageItem<T>;

      // Check expiration
      if (item.expiresAt && Date.now() > item.expiresAt) {
        storage.removeItem(key);
        return null;
      }

      return item.value;
    } catch {
      // Fallback: try to parse as plain value (backward compatibility)
      return JSON.parse(stored) as T;
    }
  } catch (error) {
    console.error(`Failed to get secure item ${key}:`, error);
    return null;
  }
}

/**
 * Remove an item from secure storage
 */
export function secureRemoveItem(key: string): void {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    console.error(`Failed to remove secure item ${key}:`, error);
  }
}

/**
 * Clear all expired items from localStorage
 */
export function clearExpiredItems(): void {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return;
  try {
    const keys = Object.keys(storage);
    let removedCount = 0;

    keys.forEach((key) => {
      try {
        const stored = storage.getItem(key);
        if (!stored) return;

        const deobfuscated = deobfuscate(stored);
        const item = JSON.parse(deobfuscated) as StorageItem<unknown>;

        if (item.expiresAt && Date.now() > item.expiresAt) {
          storage.removeItem(key);
          removedCount++;
        }
      } catch {
        // Skip items that aren't secure storage items
      }
    });

    if (removedCount > 0) {
      console.log(`Cleared ${removedCount} expired items from storage`);
    }
  } catch (error) {
    console.error('Failed to clear expired items:', error);
  }
}

/**
 * Clear all application data from localStorage
 * Useful for logout or reset functionality
 */
export function clearAppStorage(prefix = 'surfJudging'): void {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return;
  try {
    const keys = Object.keys(storage);
    keys.forEach((key) => {
      if (key.startsWith(prefix)) {
        storage.removeItem(key);
      }
    });
    console.log(`Cleared all ${prefix} data from storage`);
  } catch (error) {
    console.error('Failed to clear app storage:', error);
  }
}

/**
 * Get storage usage information
 */
export function getStorageInfo(): { used: number; available: number; percentage: number } {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return { used: 0, available: 0, percentage: 0 };
  try {
    let used = 0;
    Object.keys(storage).forEach((key) => {
      const item = storage.getItem(key);
      used += (key.length + (item?.length ?? 0)) * 2; // UTF-16 encoding
    });

    // Most browsers provide ~5-10MB, we'll assume 5MB as conservative estimate
    const available = 5 * 1024 * 1024; // 5MB in bytes
    const percentage = (used / available) * 100;

    return {
      used: Math.round(used / 1024), // KB
      available: Math.round(available / 1024), // KB
      percentage: Math.round(percentage * 100) / 100,
    };
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return { used: 0, available: 0, percentage: 0 };
  }
}

/**
 * Check if localStorage is available and working
 */
export function isStorageAvailable(): boolean {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return false;
  try {
    const testKey = '__storage_test__';
    storage.setItem(testKey, 'test');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Set item with session-only expiration (cleared when browser closes)
 */
export function sessionSetItem<T>(key: string, value: T): void {
  const storage = getBrowserStorage('sessionStorage');
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to set session item ${key}:`, error);
  }
}

/**
 * Get item from session storage
 */
export function sessionGetItem<T>(key: string): T | null {
  const storage = getBrowserStorage('sessionStorage');
  if (!storage) return null;
  try {
    const stored = storage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : null;
  } catch (error) {
    console.error(`Failed to get session item ${key}:`, error);
    return null;
  }
}

/**
 * Remove item from session storage
 */
export function sessionRemoveItem(key: string): void {
  const storage = getBrowserStorage('sessionStorage');
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    console.error(`Failed to remove session item ${key}:`, error);
  }
}

/**
 * Initialize storage cleanup on app load
 * Call this once when the app starts
 */
export function initStorageCleanup(): void {
  // Clear expired items on load
  clearExpiredItems();

  // Set up periodic cleanup (every hour)
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  setInterval(clearExpiredItems, CLEANUP_INTERVAL);

  // Clear expired items when window becomes visible again
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        clearExpiredItems();
      }
    });
  }

  // Log storage usage for monitoring
  const storageInfo = getStorageInfo();
  if (storageInfo.percentage > 80) {
    console.warn(
      `localStorage usage is high: ${storageInfo.percentage}% (${storageInfo.used}KB / ${storageInfo.available}KB)`
    );
  }
}
