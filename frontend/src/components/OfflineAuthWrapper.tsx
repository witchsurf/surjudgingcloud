/**
 * Offline Auth Wrapper
 *
 * Handles offline authentication bypass for local/dev usage:
 * 1. Dev Mode: Auto-login with dev credentials
 * 2. Offline Mode: Use stored credentials from previous online session
 * 3. Online Mode: Normal Supabase magic link flow
 */

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  isDevMode,
  getDevUser,
  getOfflineUser,
  hasValidOfflineAccess,
  saveOfflineCredentials,
  updateLastSync,
} from '../lib/offlineAuth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface OfflineAuthWrapperProps {
  children: (user: User | null, isOfflineMode: boolean) => React.ReactNode;
}

export function OfflineAuthWrapper({ children }: OfflineAuthWrapperProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Prevent re-initialization
    if (initialized) return;

    let mounted = true;

    async function initAuth() {
      // 1. Check if dev mode is enabled - skip ALL auth checks
      if (isDevMode()) {
        const devUser = getDevUser();
        if (mounted) {
          setUser(devUser);
          setIsOfflineMode(true);
          setIsLoading(false);
          setInitialized(true);
        }
        console.log('🔧 Dev mode enabled - bypassing all auth, auto-login as:', devUser?.email);
        return; // Exit immediately, don't check Supabase
      }

      // 2. Check if Supabase is configured
      if (!supabase || !isSupabaseConfigured()) {
        // Check for offline credentials
        const offlineUser = getOfflineUser();
        if (offlineUser && hasValidOfflineAccess()) {
          if (mounted) {
            // Convert OfflineUser to Supabase User format
            const mockUser: User = {
              id: offlineUser.id,
              email: offlineUser.email,
              app_metadata: {},
              user_metadata: {},
              aud: 'authenticated',
              created_at: offlineUser.createdAt,
            } as User;

            setUser(mockUser);
            setIsOfflineMode(true);
            setIsLoading(false);
            setInitialized(true);
          }
          console.log('📴 Offline mode - using stored credentials:', offlineUser.email);
          return;
        }

        if (mounted) {
          setUser(null);
          setIsOfflineMode(false);
          setIsLoading(false);
          setInitialized(true);
        }
        return;
      }

      // 3. Try to get user from Supabase (online mode)
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error) throw error;

        if (data.user && mounted) {
          setUser(data.user);
          setIsOfflineMode(false);
          setInitialized(true);

          // Save credentials for offline use
          const session = await supabase.auth.getSession();
          if (session.data.session) {
            saveOfflineCredentials(
              data.user,
              session.data.session.access_token,
              session.data.session.refresh_token
            );
            updateLastSync();
          }
        } else {
          // No online user, check offline fallback
          const offlineUser = getOfflineUser();
          if (offlineUser && hasValidOfflineAccess() && mounted) {
            const mockUser: User = {
              id: offlineUser.id,
              email: offlineUser.email,
              app_metadata: {},
              user_metadata: {},
              aud: 'authenticated',
              created_at: offlineUser.createdAt,
            } as User;

            setUser(mockUser);
            setIsOfflineMode(true);
            setInitialized(true);
            console.log('📴 Offline fallback mode:', offlineUser.email);
          }
        }
      } catch (error) {
        console.error('❌ Auth error:', error);

        // Fallback to offline mode on error
        const offlineUser = getOfflineUser();
        if (offlineUser && hasValidOfflineAccess() && mounted) {
          const mockUser: User = {
            id: offlineUser.id,
            email: offlineUser.email,
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: offlineUser.createdAt,
          } as User;

          setUser(mockUser);
          setIsOfflineMode(true);
          setInitialized(true);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          if (!initialized) {
            setInitialized(true);
          }
        }
      }
    }

    initAuth();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Separate effect for auth listener
  useEffect(() => {
    if (!initialized || isDevMode()) return;

    // Listen for auth state changes (online mode only, NOT in dev mode)
    if (supabase && isSupabaseConfigured()) {
      const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
        setUser(session?.user ?? null);
        setIsOfflineMode(false);

        if (session?.user) {
          saveOfflineCredentials(
            session.user,
            session.access_token,
            session.refresh_token
          );
          updateLastSync();
        }
      });

      return () => {
        listener.subscription.unsubscribe();
      };
    }
  }, [initialized]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p>Initialisation...</p>
        </div>
      </div>
    );
  }

  // Render children directly without memoization
  return <>{children(user, isOfflineMode)}</>;
}
