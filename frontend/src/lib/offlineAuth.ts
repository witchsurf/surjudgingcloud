/**
 * Offline-First Authentication System
 *
 * Production Flow:
 * 1. User pays online → creates Supabase account
 * 2. Credentials stored locally (encrypted)
 * 3. Offline work enabled with periodic sync
 *
 * Dev Mode:
 * - Bypass auth for local testing
 * - Set VITE_DEV_MODE=true in .env.local
 */

import type { User } from '@supabase/supabase-js';

const OFFLINE_USER_KEY = 'surfjudging_offline_user';
const OFFLINE_CREDS_KEY = 'surfjudging_offline_credentials';
const OFFLINE_PIN_KEY = 'surfjudging_offline_pin';

export interface OfflineUser {
  id: string;
  email: string;
  subscription: {
    plan: 'free' | 'basic' | 'pro';
    validUntil: string;
    isPaid: boolean;
  };
  createdAt: string;
  lastOnlineSync: string | null;
}

interface StoredCredentials {
  email: string;
  accessToken: string;
  refreshToken: string;
  encryptedPin?: string;
}

/**
 * Check if dev mode is enabled
 */
export function isDevMode(): boolean {
  return import.meta.env.VITE_DEV_MODE === 'true';
}

/**
 * Get dev user (for local testing)
 */
export function getDevUser(): User | null {
  if (!isDevMode()) return null;

  // If a real user has been synced/saved locally, prioritize their identity
  const stored = localStorage.getItem(OFFLINE_USER_KEY);
  if (stored) {
    try {
      const offlineUser = JSON.parse(stored) as OfflineUser;
      return {
        id: offlineUser.id,
        email: offlineUser.email,
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: offlineUser.createdAt,
      } as User;
    } catch (e) {
      console.warn('Failed to parse offline user for dev mode fallback');
    }
  }

  const devEmail = import.meta.env.VITE_DEV_USER_EMAIL || 'dev@surfjudging.local';

  return {
    id: '00000000-0000-0000-0000-000000000000',
    email: devEmail,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

/**
 * Save user credentials for offline use (after first online login)
 */
export function saveOfflineCredentials(user: User, accessToken: string, refreshToken: string): void {
  if (isDevMode()) {
    console.log('🔧 Dev mode: Skipping credential save');
    return;
  }

  const credentials: StoredCredentials = {
    email: user.email!,
    accessToken,
    refreshToken,
  };

  localStorage.setItem(OFFLINE_CREDS_KEY, JSON.stringify(credentials));

  const offlineUser: OfflineUser = {
    id: user.id,
    email: user.email!,
    subscription: {
      plan: 'basic', // Can be updated from Stripe/payment system
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      isPaid: true,
    },
    createdAt: user.created_at,
    lastOnlineSync: new Date().toISOString(),
  };

  localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(offlineUser));
  console.log('✅ Offline credentials saved for:', user.email);
}

/**
 * Get stored offline user
 */
export function getOfflineUser(): OfflineUser | null {
  if (isDevMode()) {
    // Return dev user in offline format
    const devUser = getDevUser();
    if (!devUser) return null;

    return {
      id: devUser.id,
      email: devUser.email!,
      subscription: {
        plan: 'pro',
        validUntil: '2099-12-31',
        isPaid: true,
      },
      createdAt: devUser.created_at,
      lastOnlineSync: null,
    };
  }

  const stored = localStorage.getItem(OFFLINE_USER_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as OfflineUser;
  } catch {
    return null;
  }
}

/**
 * Get stored credentials
 */
export function getOfflineCredentials(): StoredCredentials | null {
  if (isDevMode()) return null;

  const stored = localStorage.getItem(OFFLINE_CREDS_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as StoredCredentials;
  } catch {
    return null;
  }
}

/**
 * Check if user has valid offline access
 */
export function hasValidOfflineAccess(): boolean {
  if (isDevMode()) return true;

  const user = getOfflineUser();
  if (!user) return false;

  // Check subscription validity
  const validUntil = new Date(user.subscription.validUntil);
  const now = new Date();

  if (now > validUntil) {
    console.warn('⚠️ Offline subscription expired:', validUntil);
    return false;
  }

  return user.subscription.isPaid;
}

/**
 * Set offline PIN (for quick offline access)
 */
export function setOfflinePin(pin: string): void {
  if (isDevMode()) return;

  // Simple PIN storage (in production, use proper encryption)
  const hashedPin = btoa(pin); // Base64 encoding (use bcrypt in production)
  localStorage.setItem(OFFLINE_PIN_KEY, hashedPin);
}

/**
 * Verify offline PIN
 */
export function verifyOfflinePin(pin: string): boolean {
  if (isDevMode()) return true; // Dev mode: any PIN works

  const stored = localStorage.getItem(OFFLINE_PIN_KEY);
  if (!stored) return false;

  const hashedPin = btoa(pin);
  return hashedPin === stored;
}

/**
 * Check if offline PIN is configured
 */
export function hasOfflinePin(): boolean {
  if (isDevMode()) return true;
  return !!localStorage.getItem(OFFLINE_PIN_KEY);
}

/**
 * Clear offline credentials (logout)
 */
export function clearOfflineCredentials(): void {
  localStorage.removeItem(OFFLINE_USER_KEY);
  localStorage.removeItem(OFFLINE_CREDS_KEY);
  localStorage.removeItem(OFFLINE_PIN_KEY);
  console.log('🔓 Offline credentials cleared');
}

/**
 * Update last sync timestamp
 */
export function updateLastSync(): void {
  if (isDevMode()) return;

  const user = getOfflineUser();
  if (!user) return;

  user.lastOnlineSync = new Date().toISOString();
  localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(user));
}

/**
 * Check if sync is needed (last sync > 7 days)
 */
export function needsSync(): boolean {
  if (isDevMode()) return false;

  const user = getOfflineUser();
  if (!user || !user.lastOnlineSync) return true;

  const lastSync = new Date(user.lastOnlineSync);
  const now = new Date();
  const daysSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceSync > 7;
}
