import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ImportParticipants from '../components/ImportParticipants';
import ParticipantsTable from '../components/ParticipantsTable';
import BracketPreview from '../components/BracketPreview';
import {
  fetchEvents,
  fetchParticipants,
  upsertParticipants,
  updateParticipant,
  deleteParticipant,
  createHeatsWithEntries,
  fetchCategoryHeats,
  subscribeToHeatUpdates,
  type EventSummary,
  type ParticipantRecord,
} from '../api/supabaseClient';
import { exportBracketToCSV, exportBracketToPDF } from '../utils/pdfExport';
import type { ComputeResult, RoundSpec, HybridPlan } from '../utils/bracket';
import { computeHeats } from '../utils/bracket';
import type { ParsedParticipant } from '../utils/csv';
import type { AppConfig } from '../types';
import { DEFAULT_TIMER_DURATION } from '../utils/constants';
import { colorLabelMap, type HeatColor } from '../utils/colorUtils';
import { supabase } from '../lib/supabase';

type FormatType = 'single-elim' | 'repechage';
type PreferredHeatSize = 'auto' | 2 | 3 | 4;
type VariantType = 'V1' | 'V2';

const ACTIVE_EVENT_STORAGE_KEY = 'surfJudgingActiveEventId';
const STORAGE_KEYS = {
  config: 'surfJudgingConfig',
  configSaved: 'surfJudgingConfigSaved',
  timer: 'surfJudgingTimer',
  scores: 'surfJudgingScores',
  currentJudge: 'surfJudgingCurrentJudge',
  judgeWorkCount: 'surfJudgingJudgeWorkCount',
} as const;

const downloadFile = (filename: string, mimeType: string, content: string | Blob) => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export default function ParticipantsStructure() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventIdParam = searchParams.get('eventId');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [participants, setParticipants] = useState<ParticipantRecord[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tableCategory, setTableCategory] = useState<string | null>(null);
  const [generatorCategory, setGeneratorCategory] = useState<string>('');
  const [format, setFormat] = useState<FormatType>('single-elim');
  const [preferredHeatSize, setPreferredHeatSize] = useState<PreferredHeatSize>('auto');
  const [variant, setVariant] = useState<VariantType>('V1');
  const [hybridEnabled, setHybridEnabled] = useState(false);
  const [hybridRound2HeatSize, setHybridRound2HeatSize] = useState<2 | 3 | 4>(4);
  const [hybridRound2Advance, setHybridRound2Advance] = useState<1 | 2>(2);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<ComputeResult | null>(null);
  const [previewCategory, setPreviewCategory] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [organizerLogoPreviewUrl, setOrganizerLogoPreviewUrl] = useState<string | null>(null);

  const selectedEvent = useMemo(
    () => events.find((evt) => evt.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const persistJudgeInterfaceConfig = useCallback(
    (event: EventSummary, category: string, roundsData: RoundSpec[], repechageData?: RoundSpec[]) => {
      if (typeof window === 'undefined') return;
      if (!roundsData.length) return;

      const categoryParticipants = participants.filter((p) => p.category === category);
      let existingConfig: Partial<AppConfig> = {};

      const existingRaw = window.localStorage.getItem(STORAGE_KEYS.config);
      if (existingRaw) {
        try {
          existingConfig = JSON.parse(existingRaw) as Partial<AppConfig>;
        } catch (error) {
          console.warn('Impossible de lire la configuration juge existante', error);
        }
      }

      const allHeats = roundsData.flatMap((round) =>
        round.heats.map((heat) => ({
          roundNumber: round.roundNumber,
          heatNumber: heat.heatNumber,
          slots: heat.slots,
        }))
      );

      if (!allHeats.length) return;

      allHeats.sort((a, b) => {
        if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
        return a.heatNumber - b.heatNumber;
      });

      const firstHeatInfo = allHeats[0];
      const jerseyOrder = firstHeatInfo.slots
        .map((slot) => {
          if (!slot.color) return null;
          const upper = slot.color.toString().toUpperCase() as HeatColor;
          const mapped = colorLabelMap[upper];
          return mapped ?? upper;
        })
        .filter((value): value is string => Boolean(value));

      const surfersPerHeatFromSlots = firstHeatInfo.slots.filter((slot) => !slot.bye).length;

      const judgesList =
        Array.isArray(existingConfig.judges) && existingConfig.judges.length > 0
          ? existingConfig.judges
          : ['J1', 'J2', 'J3'];

      const surfersList =
        jerseyOrder.length > 0
          ? jerseyOrder
          : Array.isArray(existingConfig.surfers) && existingConfig.surfers.length > 0
            ? existingConfig.surfers
            : ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'];

      const wavesCount = typeof existingConfig.waves === 'number' ? existingConfig.waves : 15;

      const totalHeatsDefault =
        roundsData.reduce((acc, round) => acc + round.heats.length, 0) +
        (repechageData?.reduce((acc, round) => acc + round.heats.length, 0) ?? 0);
      const totalHeats =
        totalHeatsDefault > 0
          ? totalHeatsDefault
          : typeof existingConfig.totalHeats === 'number'
            ? existingConfig.totalHeats
            : 0;

      const totalRoundsDefault = roundsData.length + (repechageData?.length ?? 0);
      const totalRounds =
        totalRoundsDefault > 0
          ? totalRoundsDefault
          : typeof existingConfig.totalRounds === 'number'
            ? existingConfig.totalRounds
            : roundsData.length || 1;

      const totalSurfers =
        categoryParticipants.length > 0
          ? categoryParticipants.length
          : typeof existingConfig.totalSurfers === 'number'
            ? existingConfig.totalSurfers
            : surfersList.length;

      const surfersPerHeat =
        surfersPerHeatFromSlots > 0
          ? surfersPerHeatFromSlots
          : typeof existingConfig.surfersPerHeat === 'number'
            ? existingConfig.surfersPerHeat
            : surfersList.length || 4;

      const tournamentType = repechageData && repechageData.length ? 'repechage' : 'elimination';

      const nextConfig: AppConfig = {
        competition: event.name,
        division: category,
        round: firstHeatInfo.roundNumber,
        heatId: firstHeatInfo.heatNumber,
        judges: judgesList,
        surfers: surfersList,
        waves: wavesCount,
        judgeNames: existingConfig.judgeNames ?? {},
        surferCountries: existingConfig.surferCountries ?? {},
        tournamentType,
        totalSurfers,
        surfersPerHeat,
        totalHeats,
        totalRounds,
      };

      try {
        window.localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(nextConfig));
        window.localStorage.setItem(STORAGE_KEYS.configSaved, 'true');
        window.localStorage.setItem(
          STORAGE_KEYS.timer,
          JSON.stringify({ isRunning: false, startTime: null, duration: DEFAULT_TIMER_DURATION })
        );
        window.localStorage.setItem(STORAGE_KEYS.scores, JSON.stringify([]));
        window.localStorage.removeItem(STORAGE_KEYS.currentJudge);
        window.localStorage.setItem(STORAGE_KEYS.judgeWorkCount, JSON.stringify({}));
        window.localStorage.setItem(ACTIVE_EVENT_STORAGE_KEY, String(event.id));
      } catch (error) {
        console.warn('Impossible de sauvegarder la configuration pour le Chef Juge', error);
      }
    },
    [participants]
  );

  const refreshPreviewFromDb = useCallback(async () => {
    if (!selectedEventId || !previewCategory) return;
    try {
      const dbRounds = await fetchCategoryHeats(selectedEventId, previewCategory);
      if (dbRounds.length) {
        setPreview((prev) => {
          const nextPreview: ComputeResult = {
            rounds: dbRounds,
            repechage: prev?.repechage ?? [],
          };
          if (selectedEvent) {
            persistJudgeInterfaceConfig(selectedEvent, previewCategory, nextPreview.rounds, nextPreview.repechage);
          }
          return nextPreview;
        });
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.warn('Impossible de rafraîchir la structure depuis Supabase', err);
    }
  }, [selectedEventId, previewCategory, selectedEvent, persistJudgeInterfaceConfig]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const data = await fetchEvents();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les événements');
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const loadParticipants = useCallback(async (eventId: number) => {
    setError(null);
    try {
      const data = await fetchParticipants(eventId);
      setParticipants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement des participants impossible');
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!events.length) return;

    const parsedQueryId = eventIdParam ? Number(eventIdParam) : NaN;
    const storedRaw = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY) : null;
    const parsedStoredId = storedRaw ? Number(storedRaw) : NaN;

    const isValid = (value: number | null | undefined) =>
      typeof value === 'number' && !Number.isNaN(value) && events.some((evt) => evt.id === value);

    let nextId: number | null = null;
    if (isValid(parsedQueryId)) {
      nextId = parsedQueryId;
    } else if (isValid(parsedStoredId)) {
      nextId = parsedStoredId;
    } else if (events.length > 0) {
      nextId = events[0].id;
    }

    if (nextId != null && nextId !== selectedEventId) {
      setSelectedEventId(nextId);
    }
  }, [events, eventIdParam, selectedEventId]);

  useEffect(() => {
    if (selectedEventId == null) return;
    if (eventIdParam === String(selectedEventId)) return;
    setSearchParams({ eventId: String(selectedEventId) }, { replace: true });
  }, [selectedEventId, eventIdParam, setSearchParams]);

  useEffect(() => {
    if (selectedEventId == null) return;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACTIVE_EVENT_STORAGE_KEY, String(selectedEventId));
  }, [selectedEventId]);

  useEffect(() => {
    if (!selectedEventId || !supabase) {
      setOrganizerLogoPreviewUrl(null);
      return;
    }

    let cancelled = false;
    const loadEventLogo = async () => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('config')
          .eq('id', selectedEventId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const config = (data?.config ?? {}) as Record<string, unknown>;
        const existingLogo = typeof config.organizerLogoDataUrl === 'string' ? config.organizerLogoDataUrl : null;
        setOrganizerLogoPreviewUrl(existingLogo);
      } catch (err) {
        if (!cancelled) {
          console.warn('Impossible de charger le logo organisateur:', err);
          setOrganizerLogoPreviewUrl(null);
        }
      }
    };

    void loadEventLogo();
    return () => {
      cancelled = true;
    };
  }, [selectedEventId]);

  useEffect(() => {
    if (selectedEventId != null) {
      loadParticipants(selectedEventId);
      setPreview(null);
      setPreviewCategory('');
    }
  }, [selectedEventId, loadParticipants]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    participants.forEach((p) => set.add(p.category));
    return Array.from(set).sort();
  }, [participants]);

  useEffect(() => {
    if (!categories.length) return;
    if (!generatorCategory || !categories.includes(generatorCategory)) {
      setGeneratorCategory(categories[0]);
    }
    if (!previewCategory || !categories.includes(previewCategory)) {
      setPreviewCategory(categories[0]);
    }
  }, [categories, generatorCategory, previewCategory]);

  const totalParticipants = useMemo(() => {
    if (!previewCategory) return 0;
    return participants.filter((p) => p.category === previewCategory).length;
  }, [participants, previewCategory]);

  useEffect(() => {
    if (!selectedEventId || !previewCategory) return;
    void refreshPreviewFromDb();
  }, [selectedEventId, previewCategory, refreshPreviewFromDb]);

  const totalHeats = useMemo(() => {
    if (!preview) return 0;
    const main = preview.rounds.reduce((acc, round) => acc + round.heats.length, 0);
    const rep = (preview.repechage ?? []).reduce((acc, round) => acc + round.heats.length, 0);
    return main + rep;
  }, [preview]);

  const roundAnchors = useMemo(() => {
    if (!preview) return [] as { id: string; label: string }[];
    const slugify = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'round';

    const roundsList = preview.rounds.map((round) => ({ id: `main-${slugify(round.name)}`, label: round.name }));
    const repechageList = (preview.repechage ?? []).map((round) => ({ id: `rep-${slugify(round.name)}`, label: round.name }));
    return [...roundsList, ...repechageList];
  }, [preview]);

  const handleImport = async (rows: ParsedParticipant[]) => {
    if (!selectedEventId) {
      setError('Sélectionnez un événement avant import.');
      return;
    }

    try {
      setImporting(true);
      await upsertParticipants(selectedEventId, rows);
      await loadParticipants(selectedEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible');
    } finally {
      setImporting(false);
    }
  };

  const handleOrganizerLogoUpload = useCallback(async (file: File) => {
    if (!selectedEventId) {
      throw new Error('S\u00e9lectionnez un \u00e9v\u00e9nement avant d\u2019ajouter un logo.');
    }
    if (!supabase) {
      throw new Error('Supabase indisponible.');
    }

    const toDataUrl = (input: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
        reader.readAsDataURL(input);
      });

    const dataUrl = await toDataUrl(file);

    const { data: eventRow, error: readError } = await supabase
      .from('events')
      .select('config')
      .eq('id', selectedEventId)
      .maybeSingle();
    if (readError) throw readError;

    const currentConfig = (eventRow?.config ?? {}) as Record<string, unknown>;
    const nextConfig = {
      ...currentConfig,
      organizerLogoDataUrl: dataUrl,
      organizerLogoUpdatedAt: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from('events')
      .update({ config: nextConfig, updated_at: new Date().toISOString() })
      .eq('id', selectedEventId);
    if (updateError) throw updateError;

    setOrganizerLogoPreviewUrl(dataUrl);
    setSuccess('Logo organisateur enregistr\u00e9.');
  }, [selectedEventId]);

  const handleUpdateParticipant = async (participant: ParticipantRecord) => {
    try {
      await updateParticipant(participant.id, participant);
      await loadParticipants(selectedEventId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mise à jour impossible');
    }
  };

  const handleDeleteParticipant = async (participant: ParticipantRecord) => {
    if (!window.confirm(`Supprimer ${participant.name}?`)) return;
    try {
      await deleteParticipant(participant.id);
      await loadParticipants(selectedEventId!);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    }
  };

  const handleGenerate = () => {
    if (!generatorCategory) {
      setError('Choisissez une catégorie pour générer les séries.');
      return;
    }
    if (!selectedEventId) {
      setError('Sélectionnez un événement.');
      return;
    }
    const categoryParticipants = participants.filter((p) => p.category === generatorCategory);
    if (!categoryParticipants.length) {
      setError('Aucun participant dans cette catégorie.');
      return;
    }

    try {
      const result = computeHeats(categoryParticipants, {
        format,
        preferredHeatSize,
        variant,
        hybridPlan: hybridEnabled
          ? ({
            enabled: true,
            round2HeatSize: hybridRound2HeatSize,
            round2Advance: hybridRound2Advance,
          } satisfies HybridPlan)
          : undefined,
      });
      setPreview(result);
      setPreviewCategory(generatorCategory);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Génération impossible');
    }
  };

  const handleConfirm = async () => {
    if (!preview || !selectedEventId || !selectedEvent) {
      setError('Prévisualisez la structure avant confirmation.');
      return;
    }

    const categoryParticipants = participants.filter((p) => p.category === previewCategory);
    const seedMap = new Map(categoryParticipants.map((p) => [p.seed, p]));

    try {
      setConfirming(true);
      setSuccess(null);
      await createHeatsWithEntries(
        selectedEventId,
        selectedEvent.name,
        previewCategory,
        preview.rounds,
        seedMap,
        { overwrite, repechage: preview.repechage }
      );

      persistJudgeInterfaceConfig(selectedEvent, previewCategory, preview.rounds, preview.repechage);

      // Initialize active_heat_pointer with first heat
      try {
        const firstHeatId = `${selectedEvent.name.toLowerCase().replace(/\s+/g, '_')}_${previewCategory.toLowerCase().replace(/\s+/g, '_')}_r1_h1`;
        if (supabase) {
          await supabase.from('active_heat_pointer').upsert({
            event_name: selectedEvent.name,
            active_heat_id: firstHeatId,
            updated_at: new Date().toISOString()
          });
          console.log('✅ active_heat_pointer initialisé:', firstHeatId);
        }
      } catch (err) {
        console.warn('⚠️ Impossible d\'initialiser active_heat_pointer:', err);
      }

      setError(null);
      setSuccess('Séries enregistrées et synchronisées avec l’interface juge.');
      await refreshPreviewFromDb();
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Écriture impossible');
    } finally {
      setConfirming(false);
    }
  };

  const handleExportParticipants = () => {
    const lines = ['seed,name,category,country,license'];
    participants.forEach((p) => {
      lines.push(
        [p.seed, JSON.stringify(p.name), JSON.stringify(p.category), JSON.stringify(p.country ?? ''), JSON.stringify(p.license ?? '')].join(',')
      );
    });
    downloadFile('participants.csv', 'text/csv', lines.join('\n'));
  };

  useEffect(() => {
    if (!selectedEventId || !previewCategory) return;
    const unsubscribe = subscribeToHeatUpdates(selectedEventId, previewCategory, () => {
      void refreshPreviewFromDb();
      setLastUpdated(new Date());
    });
    return () => {
      unsubscribe?.();
    };
  }, [selectedEventId, previewCategory, refreshPreviewFromDb]);

  const handleExportBrackets = (type: 'pdf' | 'csv') => {
    if (!preview || !selectedEvent) return;
    if (type === 'pdf') {
      const surferNames: Record<string, string> = {};
      const collectNames = (rounds?: RoundSpec[]) => {
        rounds?.forEach((round) => {
          round.heats.forEach((heat) => {
            heat.slots.forEach((slot) => {
              if (!slot.color || !slot.name) return;
              const label = colorLabelMap[slot.color]?.toUpperCase?.() ?? slot.color.toUpperCase();
              surferNames[label] = slot.name;
            });
          });
        });
      };

      collectNames(preview.rounds);
      collectNames(preview.repechage);

      // Build event details
      const eventDetails = selectedEvent.organizer ? {
        organizer: selectedEvent.organizer,
        date: selectedEvent.start_date ? new Date(selectedEvent.start_date).toLocaleDateString('fr-FR') : undefined,
      } : undefined;

      exportBracketToPDF(selectedEvent.name, previewCategory, preview.rounds, preview.repechage, surferNames, eventDetails);
    } else {
      const csv = exportBracketToCSV(selectedEvent.name, previewCategory, preview.rounds, preview.repechage);
      downloadFile(`${previewCategory}_heats.csv`, 'text/csv', csv);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 sm:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold">Participants et Structure d’Événement</h1>
          <p className="text-sm text-slate-300">
            Importez vos participants, gérez les inscriptions et générez automatiquement vos séries.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="text-slate-300">Événement</label>
            <select
              disabled={loadingEvents}
              value={selectedEventId ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                const nextId = value ? Number(value) : null;
                setSelectedEventId(nextId);
                if (typeof window !== 'undefined') {
                  if (nextId != null) {
                    window.localStorage.setItem(ACTIVE_EVENT_STORAGE_KEY, String(nextId));
                  } else {
                    window.localStorage.removeItem(ACTIVE_EVENT_STORAGE_KEY);
                  }
                }
                if (nextId != null) {
                  setSearchParams({ eventId: String(nextId) }, { replace: true });
                } else {
                  setSearchParams({}, { replace: true });
                }
              }}
              className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
            >
              <option value="" disabled>
                Sélectionner...
              </option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadEvents}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              Rafraîchir
            </button>
          </div>
          {selectedEvent && (
            <p className="text-xs text-slate-500">
              {selectedEvent.organizer ? `Organisé par ${selectedEvent.organizer}` : 'Organisateur non précisé'}
            </p>
          )}
        </header>

        {error && <div className="rounded-2xl border border-red-400/70 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {success && !error && (
          <div className="rounded-2xl border border-emerald-400/70 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
          </div>
        )}

        <ImportParticipants
          onImport={handleImport}
          onLogoUpload={handleOrganizerLogoUpload}
          logoPreviewUrl={organizerLogoPreviewUrl}
          disabled={!selectedEventId || importing}
        />

        <ParticipantsTable
          participants={participants}
          categories={categories}
          selectedCategory={tableCategory}
          onCategoryChange={setTableCategory}
          onUpdate={handleUpdateParticipant}
          onDelete={handleDeleteParticipant}
          onExport={handleExportParticipants}
        />

        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-blue-500/10">
          <div className="border-b border-slate-800 px-6 py-4">
            <h2 className="text-lg font-semibold text-white">Générer les séries</h2>
            <p className="text-xs text-slate-400">Choisissez la catégorie et le format pour créer la structure des rounds.</p>
          </div>

          <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="text-xs uppercase tracking-widest text-slate-400">Catégorie</label>
                <select
                  value={generatorCategory}
                  onChange={(event) => setGeneratorCategory(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
                >
                  <option value="">Sélectionner...</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-slate-400">Format</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormat('single-elim')}
                    className={`flex-1 rounded-2xl px-4 py-2 text-sm ${format === 'single-elim' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'}`}
                  >
                    Élimination directe
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormat('repechage')}
                    className={`flex-1 rounded-2xl px-4 py-2 text-sm ${format === 'repechage' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'}`}
                  >
                    Repêchage
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-widest text-slate-400">Taille de série préférée</label>
                  <select
                    value={preferredHeatSize}
                    onChange={(event) => setPreferredHeatSize(event.target.value as PreferredHeatSize)}
                    className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                  >
                    <option value="auto">Auto</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-widest text-slate-400">Format du Round 2</span>
                  <div className="mt-2 flex gap-2">
                    <label
                      className={`flex-1 cursor-pointer rounded-2xl px-4 py-2 text-center text-sm font-semibold ${variant === 'V1' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'
                        }`}
                    >
                      <input
                        type="radio"
                        name="round2-format"
                        value="V1"
                        checked={variant === 'V1'}
                        onChange={() => setVariant('V1')}
                        className="sr-only"
                      />
                      Heats de 3 (Finale à 4)
                    </label>
                    <label
                      className={`flex-1 cursor-pointer rounded-2xl px-4 py-2 text-center text-sm font-semibold ${variant === 'V2' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300'
                        }`}
                    >
                      <input
                        type="radio"
                        name="round2-format"
                        value="V2"
                        checked={variant === 'V2'}
                        onChange={() => setVariant('V2')}
                        className="sr-only"
                      />
                      Man-on-Man (2 surfeurs)
                    </label>
                  </div>
                </div>
              </div>

              {format === 'single-elim' && (
                <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-4">
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={hybridEnabled}
                      onChange={(event) => setHybridEnabled(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-400"
                    />
                    Activer plan hybride (R1 auto, puis R2 custom, puis man-on-man)
                  </label>

                  {hybridEnabled && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-widest text-slate-400">R2 taille de heat</label>
                        <select
                          value={hybridRound2HeatSize}
                          onChange={(event) => setHybridRound2HeatSize(Number(event.target.value) as 2 | 3 | 4)}
                          className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                        >
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-widest text-slate-400">R2 qualifiés / heat</label>
                        <select
                          value={hybridRound2Advance}
                          onChange={(event) => setHybridRound2Advance(Number(event.target.value) as 1 | 2)}
                          className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  id="overwrite"
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-400"
                />
                <label htmlFor="overwrite">Écraser les heats planifiés existants de cette catégorie</label>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                className="w-full rounded-full bg-blue-500 px-6 py-3 text-sm font-semibold text-white shadow shadow-blue-500/30 transition hover:bg-blue-400"
              >
                Générer la prévisualisation
              </button>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-4 text-sm text-slate-300">
              <p><strong>Snake seeding</strong> : distribue les têtes de série en aller/retour sur les heats.</p>
              <p className="mt-2">Les 3e/4e places alimentent automatiquement le repêchage si le format est sélectionné.</p>
              <p className="mt-2">Les byes sont attribuées aux meilleurs seeds lorsque le nombre de participants ne remplit pas la série.</p>
              <p className="mt-2">Plan hybride: Round 2 configurable (ex: heats de 4), puis bascule automatique en man-on-man jusqu’à la finale.</p>
            </div>
          </div>

          {preview && (
            <div className="border-t border-slate-800 px-6 py-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-sky-500/10 px-3 py-1 font-semibold text-sky-300">
                    {totalParticipants} participants
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-300">
                    {totalHeats} heats
                  </span>
                  {lastUpdated && (
                    <span className="rounded-full bg-slate-700/40 px-3 py-1 font-medium text-slate-200">
                      Dernière mise à jour : {lastUpdated.toLocaleTimeString('fr-FR')}
                    </span>
                  )}
                </div>
                {roundAnchors.length > 1 && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs uppercase tracking-widest text-slate-400">Aller à</label>
                    <select
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
                      onChange={(event) => {
                        const anchorId = event.target.value;
                        if (anchorId) {
                          document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Round…
                      </option>
                      {roundAnchors.map((round) => (
                        <option key={round.id} value={round.id}>
                          {round.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <BracketPreview
                rounds={preview.rounds}
                repechage={preview.repechage}
                onExportPdf={() => handleExportBrackets('pdf')}
                onExportCsv={() => handleExportBrackets('csv')}
              />

              {categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-xs text-slate-200">
                  <span className="text-slate-400">Divisions disponibles :</span>
                  {categories.map((category) => (
                    <span
                      key={category}
                      className={`rounded-full px-3 py-1 font-semibold ${category === previewCategory ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40' : 'bg-slate-800 text-slate-200 border border-slate-700'
                        }`}
                    >
                      {category}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedEvent && previewCategory) {
                      const target = `/app?event=${encodeURIComponent(selectedEvent.name)}&division=${encodeURIComponent(previewCategory)}`;
                      navigate(target);
                    } else {
                      navigate('/app');
                    }
                  }}
                  className="rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-blue-400 hover:text-blue-100"
                >
                  Aller à l’interface Chef Juge
                </button>
                <button
                  type="button"
                  disabled={confirming}
                  onClick={handleConfirm}
                  className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {confirming ? 'Enregistrement...' : 'Confirmer et écrire dans la base'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
