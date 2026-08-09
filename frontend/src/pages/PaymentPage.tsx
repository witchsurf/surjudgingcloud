import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { DEFAULT_TIMER_DURATION } from '../utils/constants';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getDeploymentMode } from '../domain/deploymentMode';
import { parseCanonicalEventId, resolveEventWorkflowState } from '../domain/eventWorkflow';
import { eventRepository } from '../repositories/EventRepository';

const PAYMENT_METHODS = [
  { id: 'stripe', label: 'Carte bancaire (Stripe)', icon: '💳' },
  { id: 'orange_money', label: 'Orange Money', icon: '📱' },
  { id: 'wave', label: 'Wave', icon: '🌊' },
];

const STORAGE_KEYS = {
  config: 'surfJudgingConfig',
  configSaved: 'surfJudgingConfigSaved',
  timer: 'surfJudgingTimer',
  scores: 'surfJudgingScores',
  currentJudge: 'surfJudgingCurrentJudge',
  judgeWorkCount: 'surfJudgingJudgeWorkCount',
  currentEvent: 'surfJudgingActiveEventId',
} as const;

const FIXED_EVENT_PRICE = 50000;

type PaymentEvent = {
  id: number | string;
  name?: string | null;
  organizer?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  currency?: string | null;
  paid?: boolean | null;
  status?: string | null;
  test_activated_at?: string | null;
  test_activated_by?: string | null;
};

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const formatEventDate = (value?: string | null) => {
  if (!value) return 'Non renseignée';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Non renseignée';
  return date.toLocaleDateString('fr-FR');
};

export default function PaymentPage() {
  const deploymentMode = getDeploymentMode();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [event, setEvent] = useState<PaymentEvent | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [loadingTestActivation, setLoadingTestActivation] = useState(false);
  const [canActivateForTest, setCanActivateForTest] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryStatus = useMemo(() => new URLSearchParams(location.search).get('status'), [location.search]);

  useEffect(() => {
    if (deploymentMode !== 'field') return;
    const eventId = parseCanonicalEventId(id);
    navigate(eventId ? `/events/participants?eventId=${eventId}` : '/my-events', { replace: true });
  }, [deploymentMode, id, navigate]);

  const seedCompetitionState = useCallback(() => {
    if (!event) return;

    const freshConfig = {
      competition: event.name ?? '',
      division: '',
      round: 1,
      heatId: 1,
      judges: ['J1', 'J2', 'J3'],
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      waves: 15,
      judgeNames: {},
      tournamentType: 'elimination',
      totalSurfers: 32,
      surfersPerHeat: 4,
      totalHeats: 8,
      totalRounds: 4,
    };

    try {
      localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(freshConfig));
      localStorage.setItem(STORAGE_KEYS.configSaved, 'false');
      localStorage.setItem(
        STORAGE_KEYS.timer,
        JSON.stringify({ isRunning: false, startTime: null, duration: DEFAULT_TIMER_DURATION })
      );
      localStorage.setItem(STORAGE_KEYS.scores, JSON.stringify([]));
      localStorage.removeItem(STORAGE_KEYS.currentJudge);
      localStorage.setItem(STORAGE_KEYS.judgeWorkCount, JSON.stringify({}));
      localStorage.setItem(STORAGE_KEYS.currentEvent, String(event.id));
    } catch (err) {
      console.warn('Impossible de préparer la configuration locale:', err);
    }
  }, [event]);

  useEffect(() => {
    if (queryStatus === 'success' && event) {
      seedCompetitionState();
      setMessage('Paiement confirmé. Préparation de votre espace participants…');
      const timeout = setTimeout(() => {
        navigate(`/events/participants?eventId=${event.id}`);
      }, 600);
      return () => clearTimeout(timeout);
    }
    if (queryStatus === 'failed') {
      setError('Le paiement a été annulé ou rejeté.');
    }
  }, [queryStatus, navigate, event, seedCompetitionState]);

  useEffect(() => {
    const loadEvent = async () => {
      if (!id) return;
      if (!supabase || !isSupabaseConfigured()) {
        setError("Supabase n'est pas configuré.");
        setLoadingEvent(false);
        return;
      }

      setLoadingEvent(true);

      try {
        const { data, error: fetchError } = await supabase
          .from('events')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (fetchError) {
          throw fetchError;
        }

        if (!data) {
          setError('Événement introuvable.');
          return;
        }

        const loadedEvent = data as PaymentEvent;
        setEvent(loadedEvent);
        if (deploymentMode === 'cloud') {
          setCanActivateForTest(await eventRepository.canActivateForTest(Number(loadedEvent.id)));
        }
      } catch (err) {
        setError(errorMessage(err, 'Impossible de charger cet événement pour le moment.'));
      } finally {
        setLoadingEvent(false);
      }
    };

    loadEvent();
  }, [deploymentMode, id]);

  const price = FIXED_EVENT_PRICE;

  const handlePayment = async () => {
    if (deploymentMode !== 'cloud') return;
    if (!event) return;
    if (!supabase || !isSupabaseConfigured()) {
      setError("Supabase n'est pas configuré.");
      return;
    }

    if ((paymentMethod === 'orange_money' || paymentMethod === 'wave') && !phoneNumber.trim()) {
      setError('Merci de renseigner le numéro de téléphone à débiter.');
      return;
    }

    setError(null);
    setMessage(null);
    setLoadingPayment(true);

    try {
      // Always send fully qualified URLs for Stripe callbacks
      const successUrl = `https://surfjudging.cloud/events/payment/${event.id}?status=success`;
      const cancelUrl = `https://surfjudging.cloud/events/payment/${event.id}?status=failed`;
      const currency = (event.currency ?? 'xof').toLowerCase();

      const { data, error: paymentError } = await supabase.functions.invoke('payments', {
        body: {
          action: 'initiate',
          eventId: Number(event.id),
          provider: paymentMethod,
          amount: price,
          currency,
          phoneNumber: paymentMethod === 'stripe' ? undefined : phoneNumber.trim(),
          successUrl,
          cancelUrl,
        },
      });

      if (paymentError) {
        throw paymentError;
      }

      if (data?.provider === 'stripe' && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      if (data?.instructions) {
        setMessage(data.instructions);
      } else {
        setMessage('Paiement initié. Veuillez confirmer la transaction sur votre appareil.');
      }
    } catch (err) {
      setError(errorMessage(err, 'Impossible de démarrer le paiement.'));
    } finally {
      setLoadingPayment(false);
    }
  };

  const handleTestActivation = async () => {
    if (deploymentMode !== 'cloud' || !event || !canActivateForTest || !supabase) return;
    const eventId = parseCanonicalEventId(event.id);
    if (!eventId) return;
    setError(null);
    setMessage(null);
    setLoadingTestActivation(true);
    try {
      await eventRepository.activateForTest(eventId);
      const { data, error: reloadError } = await supabase
        .from('events')
        .select('id, name, organizer, start_date, end_date, currency, paid, status, test_activated_at, test_activated_by')
        .eq('id', eventId)
        .maybeSingle();
      if (reloadError) throw reloadError;
      const state = resolveEventWorkflowState(data);
      if (state.paymentStatus !== 'test_activated') {
        throw new Error("L’activation test n’a pas été confirmée par la base.");
      }
      setEvent(data as PaymentEvent);
      setCanActivateForTest(false);
      seedCompetitionState();
      setMessage('Activation test confirmée en base. Aucun paiement réel n’a été enregistré.');
      navigate(`/events/participants?eventId=${eventId}`);
    } catch (err) {
      setError(errorMessage(err, "Impossible d’activer cet événement pour test."));
    } finally {
      setLoadingTestActivation(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-12 text-white sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl shadow-blue-500/20 backdrop-blur sm:p-10">
        <div className="mb-6 text-sm text-blue-300">
          <Link to="/events/new" className="hover:underline">
            ← Retour à la création
          </Link>
        </div>

        <h2 className="text-3xl font-bold">Paiement de l’événement</h2>
        <p className="mt-2 text-sm text-slate-300">
          Finalisez votre inscription pour débloquer le scoring SurfJudging.
        </p>

        {loadingEvent && <p className="mt-6 text-slate-300">Chargement des informations…</p>}

        {!loadingEvent && event && (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-inner shadow-black/20">
              <h3 className="text-lg font-semibold text-blue-200">{event.name}</h3>
              <p className="mt-1 text-sm text-slate-300">Organisé par {event.organizer}</p>
              <div className="mt-4 grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-slate-400">Date de début</p>
                  <p>{formatEventDate(event.start_date)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Date de fin</p>
                  <p>{formatEventDate(event.end_date)}</p>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-xl bg-blue-500/10 px-4 py-3">
                <span className="text-sm uppercase tracking-widest text-blue-200">Montant</span>
                <span className="text-2xl font-bold text-blue-300">
                  {price.toLocaleString('fr-FR', { style: 'currency', currency: 'XOF' })}
                </span>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-200">Choisissez une méthode de paiement :</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setPaymentMethod(method.id)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      paymentMethod === method.id
                        ? 'border-blue-400 bg-blue-500/10 text-blue-100 shadow-lg shadow-blue-500/20'
                        : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-blue-400/50 hover:text-blue-100'
                    }`}
                  >
                    <span className="text-lg" role="img" aria-hidden="true">
                      {method.icon}
                    </span>{' '}
                    <span className="ml-2">{method.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {(paymentMethod === 'orange_money' || paymentMethod === 'wave') && (
              <div>
                <label className="block text-sm font-medium text-slate-200">Numéro de téléphone</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="Ex : 770001122"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 shadow-inner shadow-black/20 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                />
                <p className="mt-2 text-xs text-slate-400">
                  Le numéro doit être enregistré sur le service {paymentMethod === 'orange_money' ? 'Orange Money' : 'Wave'}.
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-400/80 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-xl border border-emerald-400/80 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {message}
              </div>
            )}

            <button
              onClick={handlePayment}
              disabled={loadingPayment}
              className="flex w-full items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loadingPayment ? 'Traitement en cours…' : 'Procéder au paiement'}
            </button>

            {deploymentMode === 'cloud' && canActivateForTest && (
              <div className="rounded-2xl border border-amber-400/70 bg-amber-500/10 p-4">
                <p className="text-sm text-amber-100">
                  Capacité réservée aux validations Cloud autorisées. Cette action ne simule pas un paiement Stripe.
                </p>
                <button
                  type="button"
                  onClick={handleTestActivation}
                  disabled={loadingTestActivation}
                  className="mt-3 flex w-full items-center justify-center rounded-full border border-amber-300 px-6 py-3 text-base font-semibold text-amber-100 transition hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingTestActivation
                    ? 'Activation test en cours…'
                    : 'Activer pour test — aucun paiement réel'}
                </button>
              </div>
            )}
          </div>
        )}

        {!loadingEvent && !event && !error && (
          <p className="mt-6 text-sm text-slate-400">Impossible de trouver cet événement.</p>
        )}
      </div>
    </div>
  );
}
