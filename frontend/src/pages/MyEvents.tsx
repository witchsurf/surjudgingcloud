
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useConfigStore } from '../stores/configStore';
import type { AppConfig } from '../types';
import { fetchEventConfigSnapshot, saveEventConfigSnapshot, type EventConfigSnapshot } from '../api/supabaseClient';
import { getFirstCategoryFromParticipants } from '../utils/eventConfig';
import { OfflineAuthWrapper } from '../components/OfflineAuthWrapper';
import { isDevMode } from '../lib/offlineAuth';
import { syncEventsFromCloud, getCachedCloudEvents, getLastSyncTime, needsCloudSync, getCloudClient } from '../utils/syncCloudEvents';



type OwnedEvent = {
  id: number;
  name: string;
  organizer?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  event_last_config?: {
    event_id: number;
    event_name: string | null;
    division: string | null;
    round: number | null;
    heat_number: number | null;
    updated_at: string | null;
  } | null;
};

const CLOUD_SYNC_AFTER_LOGIN_KEY = 'surfjudging_cloud_sync_after_login';
const CLOUD_EMAIL_KEY = 'surfjudging_cloud_email';

const DEFAULT_APP_CONFIG: AppConfig = {
  competition: '',
  division: 'OPEN',
  round: 1,
  heatId: 1,
  judges: ['J1', 'J2', 'J3'],
  surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
  waves: 15,
  judgeNames: {},
  surferNames: {},
  surferCountries: {},
  tournamentType: 'elimination',
  totalSurfers: 32,
  surfersPerHeat: 4,
  totalHeats: 8,
  totalRounds: 1
};

const buildConfigFromSnapshot = (eventName: string, snapshot: EventConfigSnapshot | null): AppConfig => {
  const next: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    competition: eventName || snapshot?.event_name || DEFAULT_APP_CONFIG.competition,
    division: snapshot?.division ?? DEFAULT_APP_CONFIG.division,
    round: snapshot?.round ?? DEFAULT_APP_CONFIG.round,
    heatId: snapshot?.heat_number ?? DEFAULT_APP_CONFIG.heatId
  };

  if (snapshot?.judges?.length) {
    next.judges = snapshot.judges.map((judge) => judge.id);
    const names: Record<string, string> = {};
    snapshot.judges.forEach((judge) => {
      names[judge.id] = judge.name ?? judge.id;
    });
    next.judgeNames = names;
  }

  // Use surfers from snapshot if available (correct heat size from database)
  if (snapshot?.surfers) {
    next.surfers = snapshot.surfers;
    next.surfersPerHeat = snapshot.surfers.length;
  }

  // Use participant names and countries from snapshot
  if (snapshot?.surferNames) {
    next.surferNames = snapshot.surferNames;
  }
  if (snapshot?.surferCountries) {
    next.surferCountries = snapshot.surferCountries;
  }

  return next;
};

type SupabaseEventRow = {
  id: number;
  name: string;
  organizer: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  event_last_config: {
    event_id: number;
    event_name: string | null;
    division: string | null;
    round: number | null;
    heat_number: number | null;
    updated_at: string | null;
  } | {
    event_id: number;
    event_name: string | null;
    division: string | null;
    round: number | null;
    heat_number: number | null;
    updated_at: string | null;
  }[] | null;
};

const normalizeOwnedEvents = (rows: SupabaseEventRow[]): OwnedEvent[] =>
  rows.map((row) => ({
    id: row.id,
    name: row.name,
    organizer: row.organizer,
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    event_last_config: Array.isArray(row.event_last_config)
      ? row.event_last_config[0] ?? null
      : row.event_last_config ?? null,
  }));

// Memoized content component to prevent unnecessary re-renders
const MyEventsContent = memo(function MyEventsContent({ initialUser, isOfflineMode }: { initialUser: User | null; isOfflineMode: boolean }) {
  const [events, setEvents] = useState<OwnedEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(initialUser);
  const [continuingId, setContinuingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Magic Link State
  const [email, setEmail] = useState('');
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // Cloud Sync State
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [cloudLoginRequired, setCloudLoginRequired] = useState(false);
  const [cloudEmail, setCloudEmail] = useState(() => (typeof window !== 'undefined' ? window.localStorage.getItem(CLOUD_EMAIL_KEY) ?? '' : ''));
  const [cloudSendingMagicLink, setCloudSendingMagicLink] = useState(false);
  const [cloudLinkSent, setCloudLinkSent] = useState(false);
  const [cloudLoginError, setCloudLoginError] = useState<string | null>(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectIntent = searchParams.get('redirect');
  const location = useLocation();
  const isLoginRoute = location.pathname === '/login';

  const { setActiveEventId, setConfig, setConfigSaved, setLoadedFromDb } = useConfigStore();

  const redirectUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const base = origin || new URL(import.meta.env.BASE_URL || '/', 'http://localhost').origin;
    const url = new URL('/my-events', base);
    if (redirectIntent) {
      url.searchParams.set('redirect', redirectIntent);
    }
    return url.toString();
  }, [redirectIntent]);

  const loginRedirectTarget = useMemo(() => {
    const params = new URLSearchParams();
    if (redirectIntent) {
      params.set('redirect', redirectIntent);
    }
    const query = params.toString();
    return query ? `/login?${query}` : '/login';
  }, [redirectIntent]);

  const loadEvents = useCallback(async (userId: string, skipOnline = false) => {
    // In dev/offline mode, load from cached cloud events
    if (skipOnline || !supabase || !isSupabaseConfigured()) {
      console.log('📴 Offline/Dev mode - loading cached cloud events');
      const cachedEvents = getCachedCloudEvents();
      setEvents(cachedEvents as any[]);
      setLastSync(getLastSyncTime());
      setLoadingEvents(false);
      console.log(`✅ Loaded ${cachedEvents.length} cached events`);
      return;
    }

    setLoadingEvents(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('id, name, organizer, status, start_date, end_date, event_last_config(event_id, event_name, division, round, heat_number, updated_at)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message ?? 'Impossible de charger vos événements.');
        setEvents([]);
      } else {
        const normalized = normalizeOwnedEvents(((data ?? []) as unknown) as SupabaseEventRow[]);
        setEvents(normalized);
      }
    } catch (err) {
      console.error('Error loading events:', err);
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // Sync initial user from wrapper (only when user ID changes)
  useEffect(() => {
    setUser(initialUser);

    if (initialUser?.id) {
      loadEvents(initialUser.id, isOfflineMode);
      // Load last sync time
      setLastSync(getLastSyncTime());
    } else {
      setEvents([]);
      setLoadingEvents(false);
    }
    // Only re-run when user ID changes or when isOfflineMode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUser?.id, isOfflineMode]);

  // Force login route when online auth is required
  useEffect(() => {
    if (isOfflineMode || user || isLoginRoute) return;
    navigate(loginRedirectTarget, { replace: true });
  }, [isOfflineMode, user?.id, isLoginRoute, loginRedirectTarget, navigate]);

  // Clear redirect params in dev/offline mode (run once on mount)
  useEffect(() => {
    if (isOfflineMode && redirectIntent) {
      const cleanUrl = `${window.location.origin}${window.location.pathname}`;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  // Magic link processing (only if not in dev/offline mode)
  useEffect(() => {
    if (isOfflineMode || !supabase || !isSupabaseConfigured()) return;
    if (typeof window === 'undefined' || !window.location.hash || window.location.hash.length <= 1) return;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const errorDescription = params.get('error_description');

    if (errorDescription) {
      setError(decodeURIComponent(errorDescription));
    }

    // Clear hash params after reading
    const cleanedUrl = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
    window.history.replaceState({}, document.title, cleanedUrl);
  }, [isOfflineMode]);

  const [checkingRedirect, setCheckingRedirect] = useState(!isOfflineMode);
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    // Skip redirect logic in offline/dev mode
    if (isOfflineMode) {
      setCheckingRedirect(false);
      return;
    }

    if (hasRedirected) return;

    let shouldRedirect = false;

    // Check URL param first
    if (redirectIntent && user && redirectIntent === 'create-event') {
      shouldRedirect = true;
      setHasRedirected(true);
      navigate('/create-event', { replace: true });
    }

    // Check localStorage fallback (more robust for magic links)
    if (!shouldRedirect && user) {
      const storedRedirect = localStorage.getItem('loginRedirect');
      if (storedRedirect === 'create-event') {
        shouldRedirect = true;
        localStorage.removeItem('loginRedirect');
        setHasRedirected(true);
        navigate('/create-event', { replace: true });
      }
    }

    setCheckingRedirect(false);
  }, [redirectIntent, user?.id, hasRedirected, isOfflineMode, navigate]);

  const handleSyncFromCloud = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      if (isDevMode()) {
        const cloudClient = getCloudClient();
        const { data: { session } } = await cloudClient.auth.getSession();
        if (!session?.access_token) {
          setCloudLoginRequired(true);
          setSyncError('Connexion cloud requise. Veuillez vous connecter.');
          return;
        }

        const cloudEvents = await syncEventsFromCloud(session.user?.email || cloudEmail || '', session.access_token);
        setEvents(cloudEvents as any[]);
        setLastSync(new Date());
        setCloudLoginRequired(false);
        setCloudLinkSent(false);
        setCloudLoginError(null);
        console.log(`✅ Synced ${cloudEvents.length} events from cloud`);
        return;
      }

      const cloudEvents = await syncEventsFromCloud(user?.email || '');
      setEvents(cloudEvents as any[]);
      setLastSync(new Date());
      console.log(`✅ Synced ${cloudEvents.length} events from cloud`);
    } catch (err: any) {
      const errorMsg = err?.message || 'Impossible de synchroniser avec le cloud';
      setSyncError(errorMsg);
      console.error('❌ Sync error:', err);
    } finally {
      setSyncing(false);
    }
  }, [cloudEmail, user?.email]);

  const handleSendCloudMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloudLoginError(null);
    if (!cloudEmail.trim()) {
      setCloudLoginError('Veuillez entrer votre email cloud.');
      return;
    }

    try {
      const cloudClient = getCloudClient();
      window.localStorage.setItem(CLOUD_EMAIL_KEY, cloudEmail.trim());
      window.localStorage.setItem(CLOUD_SYNC_AFTER_LOGIN_KEY, 'true');
      setCloudSendingMagicLink(true);
      const { error: signInError } = await cloudClient.auth.signInWithOtp({
        email: cloudEmail.trim(),
        options: { emailRedirectTo: redirectUrl }
      });
      if (signInError) throw signInError;
      setCloudLinkSent(true);
    } catch (err: any) {
      setCloudLoginError(err?.message ?? 'Impossible d’envoyer le lien cloud.');
    } finally {
      setCloudSendingMagicLink(false);
    }
  };

  useEffect(() => {
    if (!isDevMode()) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(CLOUD_SYNC_AFTER_LOGIN_KEY) !== 'true') return;

    let cancelled = false;
    const attemptAutoSync = async () => {
      try {
        const cloudClient = getCloudClient();
        const { data: { session } } = await cloudClient.auth.getSession();
        if (!session?.access_token || cancelled) return;
        window.localStorage.removeItem(CLOUD_SYNC_AFTER_LOGIN_KEY);
        await handleSyncFromCloud();
      } catch (err) {
        console.warn('Auto sync after cloud login failed:', err);
      }
    };

    attemptAutoSync();
    return () => {
      cancelled = true;
    };
  }, [handleSyncFromCloud]);

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Veuillez entrer votre email.");
      return;
    }
    if (!supabase || !isSupabaseConfigured()) {
      setError("Supabase n'est pas configuré.");
      return;
    }

    // Save redirect intent to localStorage to survive the email round-trip
    if (redirectIntent) {
      localStorage.setItem('loginRedirect', redirectIntent);
    }

    setSendingMagicLink(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectUrl
        }
      });
      if (signInError) throw signInError;
      setLinkSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Impossible d'envoyer le lien de connexion.");
    } finally {
      setSendingMagicLink(false);
    }
  };

  const handleUseEvent = async (event: OwnedEvent) => {
    setActionError(null);
    setContinuingId(event.id);
    try {
      // In offline/dev mode, use cached event_last_config instead of fetching
      let snapshot: EventConfigSnapshot | null;

      if (isOfflineMode && event.event_last_config) {
        console.log('📴 Offline mode - using cached event_last_config');
        snapshot = {
          event_id: event.event_last_config.event_id,
          event_name: event.event_last_config.event_name ?? event.name ?? DEFAULT_APP_CONFIG.competition,
          division: event.event_last_config.division ?? DEFAULT_APP_CONFIG.division,
          round: event.event_last_config.round ?? DEFAULT_APP_CONFIG.round,
          heat_number: event.event_last_config.heat_number ?? DEFAULT_APP_CONFIG.heatId,
          judges: [],
          surfers: [],
          surferNames: {},
          surferCountries: {},
          updated_at: event.event_last_config.updated_at ?? new Date().toISOString(),
        };
      } else {
        snapshot = await fetchEventConfigSnapshot(event.id);
      }

      // If no snapshot exists, auto-save config with first category
      if (!snapshot) {
        console.log('📝 No config snapshot found, auto-creating with first category...');

        // Get first category from participants
        const firstCategory = await getFirstCategoryFromParticipants(event.id);
        const division = firstCategory || 'OPEN';

        console.log(`  → First category: ${division}`);

        // Build config with this division
        const config = buildConfigFromSnapshot(event.name, {
          event_id: event.id,
          event_name: event.name,
          division,
          round: 1,
          heat_number: 1,
          judges: [
            { id: 'J1', name: 'J1' },
            { id: 'J2', name: 'J2' },
            { id: 'J3', name: 'J3' }
          ],
          surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
          surferNames: {},
          surferCountries: {},
          updated_at: new Date().toISOString()
        });

        // Auto-save to event_last_config
        try {
          await saveEventConfigSnapshot({
            eventId: event.id,
            eventName: event.name,
            division,
            round: 1,
            heatNumber: 1,
            judges: config.judges.map(id => ({
              id,
              name: config.judgeNames[id] || id
            }))
          });
          console.log('✅ Config auto-saved to event_last_config');

          // Update global state
          setConfig(config);
          setConfigSaved(true); // NOW config is saved!
          setLoadedFromDb(true); // Mark as loaded from DB
          setActiveEventId(event.id);

          // Backup to localStorage
          localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
          localStorage.setItem('surfJudgingConfigSaved', 'true');
          localStorage.setItem('surfJudgingActiveEventId', event.id.toString());

        } catch (saveError) {
          console.warn('⚠️ Failed to auto-save config, continuing in offline mode:', saveError);

          // Still set config but mark as unsaved
          setConfig(config);
          setConfigSaved(false);
          setActiveEventId(event.id);

          localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
          localStorage.setItem('surfJudgingConfigSaved', 'false');
          localStorage.setItem('surfJudgingActiveEventId', event.id.toString());
        }
      } else {
        // Snapshot exists, use it normally
        console.log('✅ Config snapshot found, loading from DB');
        const config = buildConfigFromSnapshot(event.name, snapshot);

        setConfig(config);
        setConfigSaved(true);
        setLoadedFromDb(true); // Mark as loaded from DB
        setActiveEventId(event.id);

        localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
        localStorage.setItem('surfJudgingConfigSaved', 'true');
        localStorage.setItem('surfJudgingActiveEventId', event.id.toString());
      }

      // Reset other state
      localStorage.setItem('surfJudgingTimer', JSON.stringify({ isRunning: false, startTime: null, duration: 15 }));
      localStorage.setItem('surfJudgingScores', JSON.stringify([]));
      localStorage.setItem('surfJudgingJudgeWorkCount', JSON.stringify({}));

      navigate('/chief-judge');
    } catch (err: any) {
      setActionError(err?.message ?? "Impossible de charger la configuration de cet événement.");
    } finally {
      setContinuingId(null);
    }
  };

  if (!supabase || !isSupabaseConfigured()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md text-center text-white space-y-4">
          <h2 className="text-2xl font-semibold">Supabase non configuré</h2>
          <p className="text-slate-300">
            Impossible d'accéder à vos événements car Supabase n'est pas configuré pour cet environnement.
          </p>
        </div>
      </div>
    );
  }

  if (checkingRedirect && user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p>Redirection en cours...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-3xl bg-slate-900/80 p-8 shadow-2xl shadow-blue-500/20 backdrop-blur sm:p-10">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-white">Connexion requise</h2>
            <p className="mt-2 text-sm text-slate-300">
              Connectez-vous pour accéder à vos événements sauvegardés.
            </p>
          </div>

          {linkSent ? (
            <div className="rounded-xl border border-emerald-400/80 bg-emerald-500/10 px-4 py-4 text-center">
              <p className="text-emerald-200">
                ✅ Un lien de connexion a été envoyé à <strong>{email}</strong>
              </p>
              <p className="mt-2 text-sm text-emerald-300">
                Vérifiez votre boîte mail et cliquez sur le lien immédiatement.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSendMagicLink} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-200">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 shadow-inner shadow-black/20 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/80 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={sendingMagicLink}
                className="flex w-full items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {sendingMagicLink ? 'Envoi en cours...' : 'Envoyer le lien de connexion'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link to="/landing" className="text-sm font-medium text-blue-300 underline-offset-4 hover:underline">
              ← Retour à l'accueil
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-white">
          <p className="text-sm text-blue-300">Bienvenue</p>
          <h1 className="mt-2 text-3xl font-bold">Mes événements</h1>
          <p className="mt-2 text-slate-300">
            Sélectionnez un événement pour reprendre la compétition là où vous l'avez laissée.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => loadEvents(user.id, isOfflineMode)}
              className="rounded-full border border-blue-400/40 bg-white/10 px-4 py-2 text-sm text-blue-100 hover:bg-white/20 transition"
            >
              🔄 Rafraîchir
            </button>

            {/* Cloud Sync Button - Cache events for offline use */}
            <button
              onClick={handleSyncFromCloud}
              disabled={syncing}
              className="rounded-full border border-purple-400/40 bg-purple-500/10 px-4 py-2 text-sm text-purple-100 hover:bg-purple-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? '⏳ Synchronisation...' : '🌐 Sync depuis Cloud'}
            </button>

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔗 Create event button clicked, navigating...');
                setTimeout(() => {
                  console.log('🔗 Executing navigation to /create-event');
                  navigate('/create-event');
                }, 0);
              }}
              className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 transition cursor-pointer"
            >
              ➕ Créer un nouvel événement
            </button>
          </div>

          {/* Sync Status */}
          {lastSync && (
            <p className="mt-2 text-xs text-slate-400">
              📅 Dernière sync: {lastSync.toLocaleString('fr-FR')}
              {needsCloudSync() && <span className="ml-2 text-amber-400">• Sync recommandée</span>}
            </p>
          )}

          {/* Sync Error */}
          {syncError && (
            <div className="mt-3 rounded-xl border border-red-400/80 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {syncError}
            </div>
          )}

          {isDevMode() && cloudLoginRequired && (
            <div className="mt-4 rounded-2xl border border-blue-400/50 bg-blue-500/10 px-4 py-4 text-sm text-blue-100">
              <p className="mb-3 font-semibold">Connexion cloud requise pour synchroniser</p>
              {cloudLinkSent ? (
                <div className="rounded-xl border border-emerald-400/60 bg-emerald-500/10 px-4 py-3 text-emerald-200">
                  ✅ Lien de connexion envoyé à <strong>{cloudEmail}</strong>. Ouvre le lien rapidement.
                </div>
              ) : (
                <form onSubmit={handleSendCloudMagicLink} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    type="email"
                    required
                    value={cloudEmail}
                    onChange={(e) => setCloudEmail(e.target.value)}
                    placeholder="votre@email.com"
                    className="flex-1 rounded-xl border border-blue-400/40 bg-slate-900 px-4 py-2 text-sm text-white placeholder:text-slate-400 focus:border-blue-300 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={cloudSendingMagicLink}
                    className="rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cloudSendingMagicLink ? 'Envoi...' : 'Envoyer le lien'}
                  </button>
                </form>
              )}
              {cloudLoginError && (
                <div className="mt-3 rounded-xl border border-red-400/70 bg-red-500/10 px-4 py-2 text-red-200">
                  {cloudLoginError}
                </div>
              )}
            </div>
          )}
        </div>

        {loadingEvents ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-300">
            Chargement de vos événements...
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-300">
            <p>Vous n'avez pas encore créé d'événement.</p>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔗 Button clicked, navigating to /create-event');
                // Use setTimeout to ensure navigation happens after current render cycle
                setTimeout(() => {
                  console.log('🔗 Executing navigation...');
                  navigate('/create-event');
                }, 0);
              }}
              className="mt-4 inline-flex items-center justify-center rounded-full bg-blue-500 px-5 py-3 text-sm font-medium text-white hover:bg-blue-400 cursor-pointer"
            >
              Créer mon premier événement
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => {
              const snapshot = event.event_last_config;
              return (
                <div key={event.id} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/20">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-semibold text-white">{event.name}</h2>
                      <p className="text-sm text-slate-400">
                        {event.organizer ? `Organisé par ${event.organizer}` : 'Organisateur non renseigné'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {event.start_date ? new Date(event.start_date).toLocaleDateString('fr-FR') : 'Dates à confirmer'}
                        {event.end_date ? ` → ${new Date(event.end_date).toLocaleDateString('fr-FR')}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      {snapshot ? (
                        <>
                          <p className="text-sm text-slate-300">
                            ↺ Dernière activité : {snapshot.updated_at ? new Date(snapshot.updated_at).toLocaleString('fr-FR') : 'inconnue'}
                          </p>
                          <p className="text-xs text-slate-400">
                            Round {snapshot.round ?? '?'} · Heat {snapshot.heat_number ?? '?'} · {snapshot.division ?? 'Division ?'}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400">Nouvel événement - aucune config sauvegardée</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      onClick={() => handleUseEvent(event)}
                      disabled={continuingId === event.id}
                      className="inline-flex items-center rounded-full bg-blue-500 px-5 py-2 text-sm font-medium text-white shadow shadow-blue-500/30 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      {continuingId === event.id ? 'Chargement...' : 'Continuer'}
                    </button>
                    <Link
                      to={`/participants?event=${event.id}`}
                      className="inline-flex items-center rounded-full border border-slate-700 bg-transparent px-5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800/60"
                    >
                      Gérer les participants
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {actionError && (
          <div className="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {actionError}
          </div>
        )}

        {/* Dev/Offline Mode Indicator */}
        {isOfflineMode && (
          <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {isDevMode() ? '🔧 Mode Développement Actif' : '📴 Mode Hors Ligne - Dernière synchro: ' + (user ? 'récente' : 'inconnue')}
          </div>
        )}
      </div>
    </div>
  );
});

// Export with Offline Auth Wrapper - Using callback to prevent re-render issues
export default function MyEvents() {
  const renderContent = useCallback((user: User | null, isOfflineMode: boolean) => (
    <MyEventsContent initialUser={user} isOfflineMode={isOfflineMode} />
  ), []);

  return (
    <OfflineAuthWrapper>
      {renderContent}
    </OfflineAuthWrapper>
  );
}
