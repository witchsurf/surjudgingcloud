import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useConfigStore } from '../stores/configStore';
import EventStatus from './EventStatus';
import { isDevMode, getDevUser } from '../lib/offlineAuth';

interface EventFormData {
  name: string;
  organizer: string;
  startDate: string;
  endDate: string;
}

const INITIAL_FORM: EventFormData = {
  name: '',
  organizer: '',
  startDate: '',
  endDate: ''
};

const CreateEvent = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setActiveEventId } = useConfigStore();
  const [formData, setFormData] = useState<EventFormData>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requiresAuth = Boolean(isSupabaseConfigured() && supabase);
  const [authChecked, setAuthChecked] = useState(!requiresAuth);
  const [authorized, setAuthorized] = useState(!requiresAuth);
  const [participantsReset, setParticipantsReset] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    // In dev mode, bypass all auth checks
    if (isDevMode()) {
      const devUser = getDevUser();
      if (devUser) {
        setAuthorized(true);
        setSessionUserId(devUser.id);
        setAuthChecked(true);
        console.log('🔧 CreateEvent: Dev mode - auto-authorized as:', devUser.email);
      }
      return;
    }

    if (!requiresAuth || !supabase) {
      setAuthChecked(true);
      setAuthorized(true);
      return;
    }

    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data?.user) {
        setAuthorized(true);
        setSessionUserId(data.user.id);
      } else {
        navigate('/my-events?redirect=create-event', { replace: true });
      }
    }).finally(() => {
      if (!cancelled) {
        setAuthChecked(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [navigate, requiresAuth]);

  useEffect(() => {
    if (participantsReset) return;
    if (!searchParams.get('fresh')) return;
    try {
      localStorage.removeItem('participants');
      localStorage.removeItem('heats');
    } catch (error) {
      console.warn('Impossible de nettoyer les participants localStorage:', error);
    } finally {
      setParticipantsReset(true);
    }
  }, [searchParams, participantsReset]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    if (!formData.name.trim() || !formData.organizer.trim()) {
      setSubmitError('Nom et organisateur sont requis.');
      return;
    }

    const eventId = `${formData.name.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const eventData: Record<string, unknown> = {
      id: eventId,
      name: formData.name.trim(),
      organizer: formData.organizer.trim(),
      startDate: formData.startDate,
      endDate: formData.endDate,
      createdAt: new Date().toISOString()
    };

    setIsSubmitting(true);
    try {
      if (isSupabaseConfigured() && supabase) {
        try {
          const { data, error } = await supabase
            .from('events')
            .insert({
              name: eventData.name,
              organizer: eventData.organizer,
              start_date: formData.startDate,
              end_date: formData.endDate,
              price: 0,
              currency: 'XOF',
              user_id: sessionUserId ?? undefined
            })
            .select('id')
            .single();

          if (error) {
            console.error('Erreur création event remote:', error);
          } else if (data?.id) {
            eventData.eventDbId = data.id;
          }
        } catch (err) {
          console.error('Erreur lors de la création de l’événement en base:', err);
        }
      }

      localStorage.setItem('eventData', JSON.stringify(eventData));

      // CRITICAL FIX: Save the numeric DB ID if available, otherwise fallback to the string ID (offline mode only)
      const activeId = eventData.eventDbId ? String(eventData.eventDbId) : eventId;

      // Use context to set active event (triggers DB load)
      const numericId = Number(activeId);
      setActiveEventId(Number.isFinite(numericId) ? numericId : null);

      localStorage.setItem('eventId', activeId);
      localStorage.setItem('surfJudgingActiveEventId', activeId);

      const defaultConfig = {
        competition: formData.name.trim(),
        division: 'OPEN',
        round: 1,
        heatId: 1,
        judges: ['J1', 'J2', 'J3'],
        surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
        waves: 15,
        judgeNames: {},
        tournamentType: 'elimination' as const,
        totalSurfers: 0,
        surfersPerHeat: 2,
        totalHeats: 0,
        totalRounds: 1
      };
      localStorage.setItem('surfJudgingConfig', JSON.stringify(defaultConfig));
      localStorage.setItem('surfJudgingConfigSaved', 'false');
      setFormData(INITIAL_FORM);
      navigate('/payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!authorized) {
    if (!authChecked) {
      return (
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
          Vérification de votre session…
        </div>
      );
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-6">
          <EventStatus />
        </div>
        <button
          onClick={() => navigate(-1)}
          className="mb-8 flex items-center text-blue-400"
        >
          ← Retour à la création
        </button>

        <h1 className="text-3xl font-bold mb-8">Créer un événement</h1>
        <p className="mb-8 text-gray-400">
          Définissez les informations essentielles pour démarrer votre compétition.
        </p>

        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          {submitError && (
            <div className="rounded border border-red-500 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {submitError}
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium">
              Nom de l'événement
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Organisateur
            </label>
            <input
              type="text"
              value={formData.organizer}
              onChange={(e) => setFormData((prev) => ({ ...prev, organizer: e.target.value }))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Date de début
              </label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData((prev) => ({ ...prev, startDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">
                Date de fin
              </label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData((prev) => ({ ...prev, endDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          <div className="flex flex-col space-y-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Création...' : 'Créer l\'événement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateEvent;
