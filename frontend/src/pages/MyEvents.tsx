
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useConfig } from '../contexts/ConfigContext';
import type { AppConfig } from '../types';
import { fetchEventConfigSnapshot, type EventConfigSnapshot } from '../api/supabaseClient';



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

export default function MyEvents() {
  const [events, setEvents] = useState<OwnedEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [continuingId, setContinuingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Magic Link State
  const [email, setEmail] = useState('');
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [processingMagicLink, setProcessingMagicLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectIntent = searchParams.get('redirect');

  const { setActiveEventId, setConfig, setConfigSaved } = useConfig();

  const baseUrl = useMemo(() => {
    const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
    return base.toString().replace(/\/$/, '');
  }, []);

  const redirectUrl = useMemo(() => {
    const url = new URL(baseUrl.toString());
    url.pathname = `${url.pathname.replace(/\/$/, '')}/my-events`;
    if (redirectIntent) {
      url.searchParams.set('redirect', redirectIntent);
    }
    return url.toString();
  }, [baseUrl, redirectIntent]);

  const loadEvents = useCallback(async (userId: string) => {
    if (!supabase || !isSupabaseConfigured()) {
      setEvents([]);
      return;
    }
    setLoadingEvents(true);
    setError(null);

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

    setLoadingEvents(false);
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured()) return;
    if (typeof window === 'undefined' || !window.location.hash || window.location.hash.length <= 1) return;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');
    const errorDescription = params.get('error_description');

    if (errorDescription) {
      setError(decodeURIComponent(errorDescription));
    }

    if (!accessToken || !refreshToken) {
      return;
    }

    setProcessingMagicLink(true);
    supabase.auth
      .setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError(sessionError.message ?? "Impossible d'activer la session depuis le lien magique.");
        } else if (type === 'magiclink') {
          setLinkSent(false);
        }
      })
      .finally(() => {
        setProcessingMagicLink(false);
        params.delete('access_token');
        params.delete('refresh_token');
        const cleanedUrl = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
        window.history.replaceState({}, document.title, cleanedUrl);
      });
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured()) return;
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user ?? null);
      if (data?.user?.id) {
        loadEvents(data.user.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.id) {
        loadEvents(session.user.id);
      } else {
        setEvents([]);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [loadEvents]);

  const [checkingRedirect, setCheckingRedirect] = useState(true);

  useEffect(() => {
    let shouldRedirect = false;

    // Check URL param first
    if (redirectIntent && user) {
      if (redirectIntent === 'create-event') {
        shouldRedirect = true;
        navigate('/create-event', { replace: true });
      }
    }

    // Check localStorage fallback (more robust for magic links)
    if (!shouldRedirect && user) {
      const storedRedirect = localStorage.getItem('loginRedirect');
      if (storedRedirect === 'create-event') {
        shouldRedirect = true;
        localStorage.removeItem('loginRedirect');
        navigate('/create-event', { replace: true });
      }
    }

    setCheckingRedirect(false);
  }, [redirectIntent, user, navigate]);

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
      const snapshot = await fetchEventConfigSnapshot(event.id);
      const config = buildConfigFromSnapshot(event.name, snapshot);

      // Update global context state immediately
      setConfig(config);
      setConfigSaved(!!snapshot);
      setActiveEventId(event.id);

      // Backup to localStorage (redundant but safe)
      localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
      localStorage.setItem('surfJudgingConfigSaved', snapshot ? 'true' : 'false');

      // Reset other state
      localStorage.setItem('surfJudgingTimer', JSON.stringify({ isRunning: false, startTime: null, duration: config.waves }));
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

          {processingMagicLink && (
            <div className="mb-4 rounded-xl border border-blue-400/80 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
              Validation de votre lien magique en cours...
            </div>
          )}

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
                disabled={sendingMagicLink || processingMagicLink}
                className="flex w-full items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {processingMagicLink
                  ? 'Activation en cours...'
                  : sendingMagicLink
                    ? 'Envoi en cours...'
                    : 'Envoyer le lien de connexion'}
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
              onClick={() => loadEvents(user.id)}
              className="rounded-full border border-blue-400/40 bg-white/10 px-4 py-2 text-sm text-blue-100 hover:bg-white/20 transition"
            >
              🔄 Rafraîchir
            </button>
            <Link
              to="/create-event"
              className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 transition"
            >
              ➕ Créer un nouvel événement
            </Link>
          </div>
        </div>

        {loadingEvents ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-300">
            Chargement de vos événements...
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-300">
            <p>Vous n'avez pas encore créé d'événement.</p>
            <Link to="/create-event" className="mt-4 inline-flex items-center justify-center rounded-full bg-blue-500 px-5 py-3 text-sm font-medium text-white hover:bg-blue-400">
              Créer mon premier événement
            </Link>
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
      </div>
    </div>
  );
}
