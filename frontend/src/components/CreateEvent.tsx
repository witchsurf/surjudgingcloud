import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useConfigStore } from '../stores/configStore';
import EventStatus from './EventStatus';
import { eventRepository } from '../repositories/EventRepository';
import { parseCanonicalEventId } from '../domain/eventWorkflow';
import { getDeploymentMode } from '../domain/deploymentMode';
import { loadFieldOrganizationProfile } from '../domain/fieldOrganization';
import {
  resolveEventCreationSubmission,
  validateEventCreationSubmission,
} from '../domain/eventCreationSubmission';

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
  // State updates are asynchronous. Keep a synchronous guard as well so a
  // double click/tap cannot send two create requests before the button rerenders.
  const submitInFlight = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const deploymentMode = getDeploymentMode();
  const requiresAuth = deploymentMode === 'cloud';
  const [authChecked, setAuthChecked] = useState(!requiresAuth);
  const [authorized, setAuthorized] = useState(!requiresAuth);
  const [participantsReset, setParticipantsReset] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    if (deploymentMode === 'field') {
      setAuthChecked(true);
      setAuthorized(true);
      return;
    }

    if (!isSupabaseConfigured() || !supabase) {
      setAuthChecked(true);
      setAuthorized(false);
      setSubmitError('Supabase Cloud est requis pour créer un événement.');
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
  }, [deploymentMode, navigate, requiresAuth]);

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

  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (deploymentMode !== 'field') return;
    let cancelled = false;
    loadFieldOrganizationProfile({ force:true }).then((profile) => {
      if (cancelled || !profile) return;
      setFormData((current) => ({...current, organizer:current.organizer || profile.organizationName}));
      setLogoDataUrl((current) => current || profile.logoDataUrl);
    });
    return () => { cancelled = true; };
  }, [deploymentMode]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setLogoDataUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitError(null);

    // Read the browser-owned values at submit time. Some Safari/WebKit date
    // interactions can update the native control before React state catches up.
    const submission = resolveEventCreationSubmission(new FormData(event.currentTarget), formData);
    const validationError = validateEventCreationSubmission(submission);
    if (validationError) {
      setSubmitError(validationError);
      submitInFlight.current = false;
      return;
    }

    const eventData: Record<string, unknown> = {
      name: submission.name,
      organizer: submission.organizer,
      startDate: submission.startDate,
      endDate: submission.endDate,
      organizerLogoDataUrl: logoDataUrl,
      createdAt: new Date().toISOString()
    };

    setIsSubmitting(true);
    const idempotencyKey = crypto.randomUUID();
    try {
      if (!isSupabaseConfigured() || !supabase) {
        setSubmitError(deploymentMode === 'field'
          ? 'La base Supabase locale est indisponible. Aucun événement terrain n’a été créé.'
          : 'Supabase Cloud est indisponible. Aucun événement n’a été créé.');
        return;
      }
      if (deploymentMode === 'cloud' && !sessionUserId) {
        setSubmitError('Une session Cloud valide est requise pour créer un événement.');
        return;
      }
      try {
          const created = await eventRepository.create({
            name: submission.name,
            organizer: submission.organizer,
            startDate: submission.startDate,
            endDate: submission.endDate,
            price: 0,
            currency: 'XOF',
            categories: [],
            judges: [],
            idempotencyKey,
          });
          const canonicalId = parseCanonicalEventId(created.id);
          if (!canonicalId) throw new Error("La base n’a pas retourné d’ID d’événement canonique.");
          eventData.id = canonicalId;
          eventData.eventDbId = canonicalId;
          eventData.persisted = true;
          eventData.paid = created.paid;
          eventData.status = created.status;
          eventData.method = created.method;
      } catch (err) {
          console.error('Erreur lors de la création de l’événement en base:', err);
          setSubmitError(err instanceof Error ? err.message : "Impossible de sauvegarder l’événement en base.");
        return;
      }

      const canonicalId = parseCanonicalEventId(eventData.eventDbId);
      if (!canonicalId) {
        setSubmitError("La base n’a pas retourné d’ID d’événement numérique canonique.");
        return;
      }

      localStorage.setItem('eventData', JSON.stringify(eventData));

      const activeId = String(canonicalId);

      // Use context to set active event (triggers DB load)
      const numericId = Number(activeId);
      setActiveEventId(Number.isFinite(numericId) ? numericId : null);

      localStorage.setItem('eventId', activeId);
      localStorage.setItem('surfJudgingActiveEventId', activeId);

      const defaultConfig = {
        competition: submission.name,
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
      navigate(deploymentMode === 'cloud'
        ? '/payment'
        : `/participants?eventId=${canonicalId}&eventName=${encodeURIComponent(submission.name)}`);
    } finally {
      submitInFlight.current = false;
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
              name="name"
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
              name="organizer"
              type="text"
              value={formData.organizer}
              onChange={(e) => setFormData((prev) => ({ ...prev, organizer: e.target.value }))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Logo de l'organisateur (Optionnel)
            </label>
            <div className="flex items-center space-x-4">
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-400 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
              />
              {logoDataUrl && (
                <div className="h-12 w-12 rounded-lg bg-white p-1 overflow-hidden border border-gray-600">
                  <img src={logoDataUrl} alt="Preview" className="h-full w-full object-contain" />
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Format recommandé : PNG ou JPG carré (ex: 200x200px)
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Date de début
              </label>
              <input
                name="startDate"
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
                name="endDate"
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
