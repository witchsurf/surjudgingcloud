import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { EventRecord, PaymentRecord, PaymentProvider } from '../types';
import { confirmPayment, createEventRecord, fetchOrganizerEvents } from './api';
import { EventForm } from './components/EventForm';
import { EventCard } from './components/EventCard';

type OrganizerEvent = EventRecord & { payments: PaymentRecord[] };

const heroBackground =
  'linear-gradient(135deg, rgba(22,101,216,0.95) 0%, rgba(14,165,233,0.95) 100%), url(https://images.unsplash.com/photo-1526402466630-4c777c79bc08?auto=format&fit=crop&w=1400&q=80)';

export default function EventsApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  const supabaseReady = useMemo(() => isSupabaseConfigured() && !!supabase, []);

  useEffect(() => {
    if (!supabaseReady) {
      setError(
        'Supabase n’est pas configuré. Définissez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY pour activer la gestion des événements.',
      );
      setLoadingAuth(false);
      return;
    }

    const init = async () => {
      const { data, error: sessionError } = await supabase!.auth.getSession();
      if (sessionError) {
        setError(sessionError.message);
      }
      setSession(data.session ?? null);
      setLoadingAuth(false);
    };

    const { data: listener } = supabase!.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    init();

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [supabaseReady]);

  const loadEvents = useCallback(async () => {
    if (!session?.user) {
      setEvents([]);
      return;
    }
    setLoadingEvents(true);
    setError(null);
    try {
      const data = await fetchOrganizerEvents(session.user.id);
      setEvents(data);
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Impossible de charger vos événements.';
      setError(description);
    } finally {
      setLoadingEvents(false);
    }
  }, [session?.user]);

  useEffect(() => {
    if (session?.user) {
      loadEvents();
    }
  }, [session?.user, loadEvents]);

  const handlePaymentConfirmationFromUrl = useCallback(async () => {
    const searchParams = new URLSearchParams(window.location.search);
    const paymentFlag = searchParams.get('payment');
    const providerRaw = searchParams.get('provider');
    const paymentIdRaw = searchParams.get('payment_id');
    const sessionId = searchParams.get('session_id') ?? undefined;
    const transactionRef = searchParams.get('transaction_ref') ?? undefined;

    if (!paymentFlag || !providerRaw || !paymentIdRaw) {
      return;
    }

    const provider = providerRaw as PaymentProvider;
    const paymentId = Number(paymentIdRaw);
    if (!paymentId || Number.isNaN(paymentId)) {
      return;
    }

    setPaymentProcessing(true);
    setInfo(null);
    setError(null);

    try {
      const result = await confirmPayment({
        provider,
        paymentId,
        sessionId,
        transactionRef,
      });

      if (result.status === 'success') {
        setInfo('Paiement confirmé. Votre événement est maintenant actif.');
      } else if (result.status === 'pending') {
        setInfo('Paiement en attente de confirmation. Merci de vérifier votre téléphone.');
      } else {
        setError('Le paiement n’a pas pu être confirmé.');
      }
      await loadEvents();
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Confirmation du paiement impossible.';
      setError(description);
    } finally {
      setPaymentProcessing(false);
      const url = new URL(window.location.href);
      url.searchParams.delete('payment');
      url.searchParams.delete('provider');
      url.searchParams.delete('payment_id');
      url.searchParams.delete('session_id');
      url.searchParams.delete('transaction_ref');
      window.history.replaceState({}, document.title, url.toString());
    }
  }, [loadEvents]);

  useEffect(() => {
    if (session?.user) {
      handlePaymentConfirmationFromUrl();
    }
  }, [session?.user, handlePaymentConfirmationFromUrl]);

  const handleSendMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setError('Merci de renseigner une adresse email.');
      return;
    }

    setError(null);
    setInfo(null);
    try {
      const { error: signInError } = await supabase!.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.href,
        },
      });
      if (signInError) {
        throw signInError;
      }
      setOtpSent(true);
      setInfo('Un lien de connexion vous a été envoyé. Consultez votre boite email.');
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Impossible d’envoyer le lien de connexion.';
      setError(description);
    }
  };

  const handleSignOut = async () => {
    await supabase!.auth.signOut();
    setEvents([]);
  };

  const handleCreateEvent = async (payload: Parameters<typeof createEventRecord>[1]) => {
    if (!session?.user) return false;
    setError(null);
    setInfo(null);
    setCreatingEvent(true);
    try {
      const created = await createEventRecord(session.user.id, payload);
      setEvents((prev) => [{ ...created, payments: [] }, ...prev]);
      setInfo('Événement créé. Vous pouvez procéder au paiement pour l’activer.');
      return true;
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Impossible de créer l’événement.';
      setError(description);
      return false;
    } finally {
      setCreatingEvent(false);
    }
  };

  if (!supabaseReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-gray-900">Module événements indisponible</h1>
          <p className="mt-4 text-gray-600">
            Configurez Supabase pour activer la gestion et le paiement des événements.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="relative">
        <div
          className="h-64 w-full bg-cover bg-center text-white"
          style={{
            backgroundImage: heroBackground,
          }}
        >
          <div className="flex h-full flex-col justify-between bg-blue-900/60">
            <nav className="flex items-center justify-between px-8 py-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">SurfJudging — Licence organisateur</h1>
                <p className="text-sm text-blue-100">Activez votre espace juge/administrateur en quelques minutes.</p>
              </div>
              {session?.user && (
                <button
                  onClick={handleSignOut}
                  className="rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  Se déconnecter
                </button>
              )}
            </nav>
            <div className="px-8 pb-10">
              <p className="max-w-2xl text-sm text-blue-100">
                Déclarez votre structure, réglez votre licence SurfJudging et débloquez les outils de scoring temps réel
                pour vos compétitions.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="-mt-16 space-y-10 px-4 pb-20 lg:px-10">
        {error && (
          <div className="mx-auto max-w-5xl rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-red-700 shadow-sm">
            {error}
          </div>
        )}

        {info && (
          <div className="mx-auto max-w-5xl rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-emerald-700 shadow-sm">
            {info}
          </div>
        )}

        {paymentProcessing && (
          <div className="mx-auto max-w-5xl rounded-xl border border-blue-200 bg-blue-50 px-6 py-4 text-blue-700 shadow-sm">
            Vérification du paiement en cours...
          </div>
        )}

        {loadingAuth ? (
          <div className="mx-auto flex min-h-[200px] max-w-md items-center justify-center rounded-xl bg-white shadow">
            <span className="text-gray-500">Chargement...</span>
          </div>
        ) : !session?.user ? (
          <section className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-gray-900">Connexion organisateur</h2>
            <p className="mt-2 text-sm text-gray-600">
              Entrez votre email pour recevoir un lien sécurisé et gérer votre licence SurfJudging.
            </p>
            <form className="mt-6 space-y-4" onSubmit={handleSendMagicLink}>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="vous@organisation.sn"
                  required
                  disabled={otpSent}
                />
              </div>
              <button
                type="submit"
                disabled={otpSent}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {otpSent ? 'Lien envoyé' : 'Recevoir un lien de connexion'}
              </button>
            </form>
            <p className="mt-4 text-xs text-gray-500">
              Nouveau sur SurfJudging ? Renseignez votre email : un compte organisateur sera créé automatiquement lors
              de votre première connexion.
            </p>
          </section>
        ) : (
          <>
            <section className="mx-auto max-w-5xl rounded-2xl border border-white bg-white p-8 shadow-xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Activer SurfJudging</h2>
                  <p className="text-sm text-gray-500">
                    Renseignez votre organisation pour générer votre licence d’utilisation. Une fois le paiement validé,
                    l’accès complet au scoring est automatiquement débloqué.
                  </p>
                </div>
              </div>
              <EventForm onSubmit={handleCreateEvent} submitting={creatingEvent} />
            </section>

            <section className="mx-auto max-w-5xl space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Historique de licences</h3>
                <button
                  onClick={() => loadEvents()}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-100"
                >
                  Rafraîchir
                </button>
              </div>

              {loadingEvents && events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-gray-500 shadow-inner">
                  Chargement des événements...
                </div>
              ) : events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-gray-500 shadow-inner">
                  Aucune licence active pour l’instant. Enregistrez votre structure via le formulaire ci-dessus et
                  finalisez le règlement pour accéder à SurfJudging.
                </div>
              ) : (
                <div className="space-y-6">
                  {events.map((event) => (
                    <EventCard key={event.id} event={event} onRefresh={loadEvents} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
