import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { DEFAULT_TIMER_DURATION } from '../utils/constants';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

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

export default function PaymentPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const queryStatus = useMemo(() => new URLSearchParams(location.search).get('status'), [location.search]);

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

        setEvent(data);
      } catch (err) {
        const message = err?.message ?? 'Impossible de charger cet événement pour le moment.';
        setError(message);
      } finally {
        setLoadingEvent(false);
      }
    };

    loadEvent();
  }, [id]);

  const price = FIXED_EVENT_PRICE;

  const handlePayment = async () => {
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
      const successUrl = `${window.location.origin}/events/payment/${event.id}?status=success`;
      const cancelUrl = `${window.location.origin}/events/payment/${event.id}?status=failed`;

      const { data, error: paymentError } = await supabase.functions.invoke('payments', {
        body: {
          action: 'initiate',
          eventId: Number(event.id),
          provider: paymentMethod,
          amount: price,
          currency: event.currency ?? 'XOF',
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
      const description = err?.message ?? 'Impossible de démarrer le paiement.';
      setError(description);
    } finally {
      setLoadingPayment(false);
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
                  <p>{new Date(event.start_date).toLocaleDateString('fr-FR')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Date de fin</p>
                  <p>{new Date(event.end_date).toLocaleDateString('fr-FR')}</p>
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
            <button
              type="button"
              onClick={async () => {
                if (!event?.id || !supabase) return;
                setLoadingPayment(true);
                setError(null);
                try {
                  // Mark event as paid in test mode
                  const { error: updateError } = await supabase
                    .from('events')
                    .update({ paid: true, status: 'active', method: 'test' })
                    .eq('id', event.id);

                  if (updateError) {
                    throw updateError;
                  }

                  setMessage("✅ Mode test activé ! Redirection vers l'espace participants…");
                  seedCompetitionState();
                  setTimeout(() => navigate(`/events/participants?eventId=${event.id}`), 1000);
                } catch (err) {
                  setError("Erreur lors de l'activation du mode test: " + (err?.message || 'Erreur inconnue'));
                } finally {
                  setLoadingPayment(false);
                }
              }}
              disabled={loadingPayment}
              className="mt-3 w-full rounded-full border-2 border-dashed border-yellow-400/60 bg-yellow-500/5 px-6 py-3 text-sm font-semibold text-yellow-200 transition hover:border-yellow-300 hover:bg-yellow-500/10 hover:text-yellow-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              🧪 Activer en mode test (bypasser le paiement)
            </button>
          </div>
        )}

        {!loadingEvent && !event && !error && (
          <p className="mt-6 text-sm text-slate-400">Impossible de trouver cet événement.</p>
        )}
      </div>
    </div>
  );
}
