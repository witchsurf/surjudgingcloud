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
  hasOfflinePin,
  verifyOfflinePin,
  isOfflineAdmin,
} from '../lib/offlineAuth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Lock, ShieldAlert, Waves } from 'lucide-react';

interface OfflineAuthWrapperProps {
  children: (user: User | null, isOfflineMode: boolean) => React.ReactNode;
}

export function OfflineAuthWrapper({ children }: OfflineAuthWrapperProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);

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

  // PIN Security Check
  useEffect(() => {
    if (initialized && isOfflineMode && !isDevMode() && hasOfflinePin()) {
      setPinRequired(true);
    } else {
      setPinRequired(false);
      setIsUnlocked(true);
    }
  }, [initialized, isOfflineMode]);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyOfflinePin(pinValue)) {
      setPinRequired(false);
      setIsUnlocked(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinValue('');
      // Haptic feedback
      try { navigator?.vibrate?.(200); } catch { /* ignore */ }
    }
  };

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

  // PIN Entry UI
  if (pinRequired && !isUnlocked) {
    const offlineUser = getOfflineUser();
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 bg-blue-500/10 rounded-3xl mb-4">
              <Lock className="w-10 h-10 text-blue-500" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Accès Sécurisé</h1>
            <p className="text-slate-400 text-sm">
              Entrez votre code PIN pour continuer hors-ligne avec <br/>
              <span className="text-blue-300 font-medium">{offlineUser?.email}</span>
            </p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div className="flex justify-center space-x-3">
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={pinValue}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setPinValue(val);
                  if (val.length === 4) {
                    // Auto-submit when 4 digits are entered
                    const isCorrect = verifyOfflinePin(val);
                    if (isCorrect) {
                      setIsUnlocked(true);
                      setPinRequired(false);
                    } else {
                      setPinError(true);
                      setPinValue('');
                    }
                  }
                }}
                placeholder="****"
                className={`w-full bg-slate-900 border-2 rounded-2xl px-4 py-4 text-3xl tracking-[1em] text-center text-white focus:outline-none transition-all ${
                  pinError ? 'border-red-500 animate-shake' : 'border-slate-800 focus:border-blue-500'
                }`}
              />
            </div>

            {pinError && (
              <div className="flex items-center justify-center space-x-2 text-red-400 animate-in fade-in slide-in-from-top-1">
                <ShieldAlert className="w-4 h-4" />
                <span className="text-sm">Code PIN incorrect</span>
              </div>
            )}

            <button
              type="submit"
              disabled={pinValue.length < 4}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-500/20"
            >
              Déverrouiller
            </button>
          </form>

          <button 
            onClick={() => window.location.reload()}
            className="w-full mt-8 text-slate-500 text-xs hover:text-slate-300 transition-colors flex items-center justify-center space-x-1"
          >
            <Waves className="w-3 h-3" />
            <span>Réessayer la connexion au réseau</span>
          </button>
        </div>
      </div>
    );
  }

  // Render children directly without memoization
  return <>{children(user, isOfflineMode)}</>;
}
