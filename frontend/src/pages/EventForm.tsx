import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export default function EventForm() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  const redirectToMyEvents = useMemo(() => {
    const base = new URL(import.meta.env.BASE_URL || '/', window.location.origin);
    base.pathname = `${base.pathname.replace(/\/$/, '')}/my-events`;
    return base.toString();
  }, []);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured()) return;
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null);
    });

    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Veuillez entrer votre email.");
      return;
    }

    setSendingMagicLink(true);
    setError(null);

    try {
      const { error: signInError } = await supabase!.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectToMyEvents,
        },
      });

      if (signInError) throw signInError;

      setLinkSent(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'envoyer le lien de connexion.");
    } finally {
      setSendingMagicLink(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase || !isSupabaseConfigured()) {
      setError("Supabase n'est pas configuré. Vérifiez vos variables d'environnement.");
      return;
    }

    if (!userId) {
      setError('Vous devez être connecté pour créer un événement.');
      return;
    }

    if (!name.trim() || !organizer.trim() || !startDate || !endDate) {
      setError('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const insertPayload: Record<string, unknown> = {
        name: name.trim(),
        organizer: organizer.trim(),
        start_date: startDate,
        end_date: endDate,
        price: 0,  // Will be set during payment if needed
        currency: 'XOF',
        categories: [],
        judges: [],
        paid: false,
        status: 'pending',
        user_id: userId,  // Always set user_id
      };

      const { data, error: insertError } = await supabase
        .from('events')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertError) {
        throw insertError;
      }

      navigate(`/events/payment/${data.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de créer cet événement pour le moment.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Show login form if not authenticated
  if (!userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-3xl bg-slate-900/80 p-8 shadow-2xl shadow-blue-500/20 backdrop-blur sm:p-10">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-white">Connexion</h2>
            <p className="mt-2 text-sm text-slate-300">
              Connectez-vous pour créer votre événement
            </p>
         </div>

          <div className="mt-6 text-center">
            <Link to="/my-events" className="text-sm font-medium text-blue-300 underline-offset-4 hover:underline">
              Accéder à mes événements
            </Link>
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
                {sendingMagicLink ? "Envoi en cours..." : "Envoyer le lien de connexion"}
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

  // Show event creation form if authenticated
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-xl rounded-3xl bg-slate-900/80 p-8 shadow-2xl shadow-blue-500/20 backdrop-blur sm:p-10">
        <div className="mb-4 text-right">
          <Link
            to="/my-events"
            className="text-sm font-medium text-blue-300 underline-offset-4 hover:underline"
          >
            ↺ Reprendre un événement
          </Link>
        </div>
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-white">Créer un événement</h2>
          <p className="mt-2 text-sm text-slate-300">
            Définissez les informations essentielles pour démarrer votre compétition.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-200">Nom de l’événement</label>
            <input
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Championnat national"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 shadow-inner shadow-black/20 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-200">Organisateur</label>
            <input
              type="text"
              required
              value={organizer}
              onChange={(event) => setOrganizer(event.target.value)}
              placeholder="Fédération Sénégalaise de Surf"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 shadow-inner shadow-black/20 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-200">Date de début</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 shadow-inner shadow-black/20 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-200">Date de fin</label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 shadow-inner shadow-black/20 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-400/80 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !userId}
            className="flex w-full items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {loading ? "Création en cours..." : !userId ? "Connexion..." : "Créer l'événement"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/landing" className="text-sm font-medium text-blue-300 underline-offset-4 hover:underline">
            Retour à l’accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
