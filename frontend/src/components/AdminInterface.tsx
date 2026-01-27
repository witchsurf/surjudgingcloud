import { AlertTriangle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { Settings, Clock, Users, Download, RotateCcw, Trash2, Database, Wifi, WifiOff, CheckCircle, ArrowRight, ClipboardCheck, AlertCircle, Info as InfoIcon, Eye, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import HeatTimer from './HeatTimer';
import type { AppConfig, HeatTimer as HeatTimerType, Score, ScoreOverrideLog, OverrideReason } from '../types';
import { validateScore } from '../utils/scoring';
import { getHeatIdentifiers, ensureHeatId } from '../utils/heat';
import { SURFER_COLORS as SURFER_COLOR_MAP } from '../utils/constants';
import { exportHeatScorecardPdf, exportFullCompetitionPDF } from '../utils/pdfExport';
import { fetchEventIdByName, fetchOrderedHeatSequence, fetchAllEventHeats, fetchAllScoresForEvent, ensureEventExists } from '../api/supabaseClient';
import { JudgeSelectorSection } from './JudgeSelectorSection';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const DEFAULT_DIVISIONS: string[] = [];
const ACTIVE_EVENT_STORAGE_KEY = 'surfJudgingActiveEventId';


interface AdminInterfaceProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onConfigSaved: (saved: boolean) => void;
  configSaved: boolean;
  timer: HeatTimerType;
  onTimerChange: (timer: HeatTimerType) => void;
  onReloadData: () => void;
  onResetAllData: () => void;
  onCloseHeat: () => void;
  judgeWorkCount: Record<string, number>;
  scores: Score[];
  overrideLogs: ScoreOverrideLog[];
  onScoreOverride: (input: {
    heatId: string;
    competition: string;
    division: string;
    round: number;
    judgeId: string;
    judgeName: string;
    surfer: string;
    waveNumber: number;
    newScore: number;
    reason: OverrideReason;
    comment?: string;
  }) => Promise<ScoreOverrideLog | undefined>;
  onRealtimeTimerStart?: (heatId: string, config: AppConfig, duration: number) => Promise<void>;
  onRealtimeTimerPause?: (heatId: string) => Promise<void>;
  onRealtimeTimerReset?: (heatId: string, duration: number) => Promise<void>;
  availableDivisions?: string[];
  loadState?: 'loading' | 'loaded' | 'empty' | 'error';
  loadError?: string | null;
  loadedFromDb?: boolean;
  activeEventId?: number;
}
const AdminInterface: React.FC<AdminInterfaceProps> = ({
  config,
  onConfigChange,
  onConfigSaved,
  configSaved,
  timer,
  onTimerChange,
  onReloadData,
  onResetAllData,
  onCloseHeat,
  judgeWorkCount,
  scores,
  overrideLogs,
  onScoreOverride,
  onRealtimeTimerStart,
  onRealtimeTimerPause,
  onRealtimeTimerReset,
  availableDivisions = [],
  loadState = 'loaded',
  loadError = null,
  loadedFromDb = false,
  activeEventId
}) => {
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [selectedJudge, setSelectedJudge] = useState('');
  const [selectedSurfer, setSelectedSurfer] = useState('');
  const [selectedWave, setSelectedWave] = useState<number | ''>('');
  const [scoreInput, setScoreInput] = useState('');
  const [showOverridePanel, setShowOverridePanel] = useState(false);
  const [overrideReason, setOverrideReason] = useState<OverrideReason>('correction');
  const [overrideComment, setOverrideComment] = useState('');
  const [overrideStatus, setOverrideStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [overridePending, setOverridePending] = useState(false);
  const [divisionOptions, setDivisionOptions] = useState<string[]>([]);
  const [displayLinkCopied, setDisplayLinkCopied] = useState(false);
  const [eventPdfPending, setEventPdfPending] = useState(false);
  const [allJudgeNames, setAllJudgeNames] = useState<Record<string, string>>({});

  // Fetch all active judges (codes + names)
  useEffect(() => {
    const fetchJudges = async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('judges')
        .select('id, name, personal_code');

      if (error) {
        console.error('Error fetching judges:', error);
        return;
      }

      if (data) {
        const names = data.reduce((acc, j) => ({ ...acc, [j.id]: j.name }), {} as Record<string, string>);
        setAllJudgeNames(names);
      }
    };
    fetchJudges();
  }, []);

  const handleJudgesSelection = (ids: string[]) => {
    const newNames = ids.reduce((acc, id) => ({
      ...acc,
      [id]: allJudgeNames[id] || config.judgeNames[id] || id
    }), {} as Record<string, string>);

    onConfigChange({
      ...config,
      judges: ids,
      judgeNames: newNames
    });
  };

  const { normalized: heatId } = React.useMemo(
    () =>
      getHeatIdentifiers(
        config.competition,
        config.division,
        config.round,
        config.heatId
      ),
    [config.competition, config.division, config.round, config.heatId]
  );

  const reasonLabels: Record<OverrideReason, string> = {
    correction: 'Correction',
    omission: 'Omission',
    probleme: 'Problème technique'
  };

  const currentScore = React.useMemo(() => {
    if (!selectedJudge || !selectedSurfer || !selectedWave) return undefined;
    return scores
      .filter(score =>
        ensureHeatId(score.heat_id) === heatId &&
        score.judge_id === selectedJudge &&
        score.surfer === selectedSurfer &&
        score.wave_number === Number(selectedWave)
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  }, [scores, heatId, selectedJudge, selectedSurfer, selectedWave]);

  const handleOverrideSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedJudge || !selectedSurfer || !selectedWave) {
      setOverrideStatus({ type: 'error', message: 'Veuillez sélectionner juge, surfeur et vague.' });
      return;
    }

    const validation = validateScore(scoreInput);
    if (!validation.isValid || validation.value === undefined) {
      setOverrideStatus({ type: 'error', message: validation.error || 'Score invalide.' });
      return;
    }

    setOverridePending(true);
    try {
      // Build heat ID for the override
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;

      const result = await onScoreOverride({
        heatId,
        competition: config.competition,
        division: config.division,
        round: config.round,
        judgeId: selectedJudge,
        judgeName: config.judgeNames[selectedJudge] || selectedJudge,
        surfer: selectedSurfer,
        waveNumber: Number(selectedWave),
        newScore: validation.value,
        reason: overrideReason,
        comment: overrideComment.trim() || undefined
      });

      if (result) {
        setOverrideStatus({
          type: 'success',
          message: `Note mise à jour à ${validation.value.toFixed(2)} (${reasonLabels[result.reason]})`
        });
      } else {
        setOverrideStatus({ type: 'success', message: 'Note mise à jour.' });
      }
    } catch (error) {
      console.error('❌ Override erreur:', error);
      setOverrideStatus({ type: 'error', message: 'Impossible d’enregistrer la correction.' });
    } finally {
      setOverridePending(false);
    }
  };

  const encodedDisplayPayload = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const payload = {
        ...config,
        judgeNames: config.judgeNames,
        configSaved,
        heatStatus: timer.isRunning ? 'running' : timer.startTime ? 'paused' : 'waiting',
        timerSnapshot: {
          ...timer,
          startTime: timer.startTime ? timer.startTime.toISOString() : null
        }
      };
      return btoa(JSON.stringify(payload));
    } catch (error) {
      console.warn('Impossible de préparer la configuration affichage:', error);
      return null;
    }
  }, [config, configSaved, timer]);

  const publicDisplayUrl = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.origin);
    url.pathname = '/display';

    // Use eventId if available (Preferred for cross-device sync)
    if (activeEventId) {
      url.searchParams.set('eventId', activeEventId.toString());
    } else if (encodedDisplayPayload) {
      // Fallback to config payload (Legacy/Offline)
      url.searchParams.set('config', encodedDisplayPayload);
    }
    return url.toString();
  }, [encodedDisplayPayload, activeEventId]);

  const handleOpenDisplay = () => {
    if (!publicDisplayUrl) return;
    window.open(publicDisplayUrl, '_blank', 'noopener');
  };

  const handleCopyDisplayLink = async () => {
    if (!publicDisplayUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(publicDisplayUrl);
      setDisplayLinkCopied(true);
      window.setTimeout(() => setDisplayLinkCopied(false), 2000);
    } catch (error) {
      console.warn('Impossible de copier le lien affichage:', error);
    }
  };

  // Évaluer le statut de la base de données
  React.useEffect(() => {
    const checkDbStatus = () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const supabaseConfigured = Boolean(
        supabaseUrl && supabaseKey && supabaseUrl !== 'undefined' && supabaseKey !== 'undefined'
      );

      if (!navigator.onLine) {
        setDbStatus('disconnected');
        return;
      }

      if (!supabaseConfigured) {
        setDbStatus('disconnected');
        return;
      }

      // Check if Supabase is actually accessible
      if (supabaseConfigured) {
        setDbStatus('connected');
      } else {
        setDbStatus('disconnected');
      }
    };

    setDbStatus('checking');
    const timeoutId = window.setTimeout(checkDbStatus, 300);

    const handleOnline = () => checkDbStatus();
    const handleOffline = () => setDbStatus('disconnected');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [configSaved]);

  const syncDivisionsFromParticipants = useCallback(() => {
    try {
      const stored = localStorage.getItem('participants');
      if (!stored) {
        if (divisionOptions.length) setDivisionOptions([]);
        return;
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        if (divisionOptions.length) setDivisionOptions([]);
        return;
      }
      const categories = Array.from(
        new Set(
          parsed
            .map((p: any) => (p?.category || '').toString().trim())
            .filter((cat: string) => cat.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      const arraysEqual =
        categories.length === divisionOptions.length &&
        categories.every((cat, idx) => cat === divisionOptions[idx]);
      if (!arraysEqual) {
        setDivisionOptions(categories);
      }

      const matchesCategory = (value: string) =>
        categories.some(cat => cat.toLowerCase() === value.toLowerCase());

      if (categories.length === 1 && !matchesCategory(config.division)) {
        onConfigChange({ ...config, division: categories[0] });
      } else if (categories.length > 1 && config.division && !matchesCategory(config.division)) {
        onConfigChange({ ...config, division: '' });
      }
    } catch (error) {
      console.warn('Impossible de lire les catégories participants:', error);
      if (divisionOptions.length) setDivisionOptions([]);
    }
  }, [divisionOptions, config, onConfigChange]);

  useEffect(() => {
    syncDivisionsFromParticipants();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'participants') {
        syncDivisionsFromParticipants();
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [syncDivisionsFromParticipants]);

  const handleConfigChange = (field: keyof AppConfig, value: any) => {
    onConfigChange({ ...config, [field]: value });
  };





  const handleSaveConfig = async () => {
    // Ensure event exists in Supabase if competition is set
    if (config.competition && isSupabaseConfigured()) {
      try {
        // ensureEventExists is now imported statically
        const eventId = await ensureEventExists(config.competition);
        // Store event ID for future use
        localStorage.setItem('surfJudgingActiveEventId', String(eventId));
        console.log(`✅ Event ensured: ${config.competition} (ID: ${eventId})`);
      } catch (error) {
        console.warn('⚠️ Could not ensure event exists:', error);
        // Continue anyway - event creation is optional
      }
    }

    onConfigSaved(true);
    // Sauvegarder immédiatement dans localStorage
    localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
    localStorage.setItem('surfJudgingConfigSaved', 'true');
  };

  const handleTimerStart = () => {
    if (timer.startTime) {
      alert("Ce heat a déjà été jugé — impossible de relancer le timer.");
      return;
    }
    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date()
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerStart && configSaved) {
      onRealtimeTimerStart(heatId, config, newTimer.duration)
        .then(() => {
          console.log('🚀 ADMIN: Timer START publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer START en mode local uniquement', error instanceof Error ? error.message : error);
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }

    console.log('▶️ ADMIN: Timer démarré:', newTimer);
  };

  const handleTimerPause = () => {
    const newTimer = {
      ...timer,
      isRunning: false
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerPause && configSaved) {
      onRealtimeTimerPause(heatId)
        .then(() => {
          console.log('⏸️ ADMIN: Timer PAUSE publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer PAUSE en mode local uniquement', error instanceof Error ? error.message : error);
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }

    console.log('⏸️ ADMIN: Timer pausé:', newTimer);
  };

  const handleTimerReset = () => {
    const newTimer = {
      ...timer,
      isRunning: false,
      startTime: null
    };

    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));

    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerReset && configSaved) {
      onRealtimeTimerReset(heatId, newTimer.duration)
        .then(() => {
          console.log('🔄 ADMIN: Timer RESET publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer RESET en mode local uniquement', error instanceof Error ? error.message : error);
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }

    console.log('🔄 ADMIN: Timer reset:', newTimer);
  };

  const handleTimerDurationChange = (duration: number) => {
    const newTimer = {
      ...timer,
      duration
    };
    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
  };

  const canCloseHeat = () => {
    // Check if at least ONE wave has been scored by MINIMUM 3 judges
    // Rules: 3 judges = avg of 3, 5 judges = drop min/max + avg of 3
    if (!scores || scores.length === 0) return false;

    const judgeCount = config.judges?.length || 0;
    // Fix: Adapt minimum requirement to the number of judges (min 3 usually, but 1 or 2 if fewer judges)
    const MIN_JUDGES_PER_WAVE = judgeCount === 0 ? 1 : Math.min(3, judgeCount);

    if (judgeCount < 3 && judgeCount > 0) {
      // Info log instead of warning when running with few judges
      console.log(`ℹ️ Mode effectif réduit (${judgeCount} juges). Seuil validité: ${MIN_JUDGES_PER_WAVE} notes.`);
    } else if (judgeCount === 0) {
      console.warn(`⚠️ Pas assez de juges configurés (${judgeCount}).`);
      return false;
    }

    // Group scores by surfer and wave
    const waveScores = new Map<string, Set<string>>();

    scores.forEach(score => {
      const key = `${score.surfer}-W${score.wave_number}`;
      if (!waveScores.has(key)) {
        waveScores.set(key, new Set());
      }
      waveScores.get(key)!.add(score.judge_id);
    });

    // Check if at least one wave has been scored by A MAJORITY of judges
    // If 3 judges, require 2. If 5 judges, require 3.
    const effectiveMinJudges = judgeCount >= 3 ? Math.ceil(judgeCount / 2) : Math.max(1, judgeCount);

    for (const [waveKey, judges] of waveScores.entries()) {
      if (judges.size >= effectiveMinJudges) {
        console.log(`✅ Vague complète trouvée: ${waveKey} (${judges.size}/${judgeCount} juges)`);
        return true;
      }
    }

    // Fallback: If we have ANY scores but didn't meet the strict criteria,
    // we return false to trigger the WARNING (checking is good), BUT
    // we should make sure the warning is clear.
    // Actually, if there are scores but not enough judges, it IS a valid warning.
    // The user's issue might be that they HAVE all scores but it still fails.
    // This could happen if `judge_id` mismatch.
    // Let's debug by logging the `judges` set content.
    console.warn(`⚠️ Pas assez de juges sur une même vague (Requis: ${effectiveMinJudges}). Détail:`, Object.fromEntries(waveScores));
    return false;
  };

  const handleCloseHeat = async () => {
    // Warning if no scores, but allow to proceed with confirmation
    if (!canCloseHeat()) {
      const forceClose = confirm(
        '⚠️ ATTENTION: Aucune vague complète enregistrée!\n\n' +
        'Ce heat sera fermé SANS RÉSULTATS.\n' +
        '(En compétition réelle, ce heat devrait être rejoué.)\n\n' +
        'Voulez-vous quand même passer au heat suivant?'
      );
      if (!forceClose) {
        return;
      }
    } else {
      // Normal confirmation
      if (!confirm(`Fermer le Heat ${config.heatId} et passer au suivant ?`)) {
        return;
      }
    }

    // Failsafe validation
    try {
      let eventId: number | null = null;
      // Try to find event ID from config or name
      if (config.competition) {
        eventId = await fetchEventIdByName(config.competition);
      }

      if (eventId) {
        // Call N8N heat-sync workflow to finalize scores and advance qualifiers
        try {
          const currentHeatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
          console.log('🔄 Calling heat-sync for:', currentHeatId);

          // Use static import for supabase instead of dynamic
          if (!supabase) throw new Error("Supabase client not initialized");

          const { data: syncData, error: syncError } = await supabase.functions.invoke('heat-sync', {
            body: {
              heat_id: currentHeatId,
              event_id: eventId,
              action: 'finalize'
            }
          });

          if (syncError) {
            console.warn('⚠️ Heat sync failed, continuing anyway:', syncError);
          } else {
            console.log('✅ Heat sync successful:', syncData);
          }
        } catch (syncErr) {
          console.warn('⚠️ Heat sync error, continuing anyway:', syncErr);
        }

        const sequence = await fetchOrderedHeatSequence(eventId, config.division);

        // Check if it was the last heat AFTER syncing
        if (sequence && sequence.length > 0) {
          const currentIndex = sequence.findIndex(h =>
            h.round === config.round && h.heat_number === config.heatId
          );

          if (currentIndex !== -1 && currentIndex === sequence.length - 1) {
            alert('🏁 Fin de l\'événement (ou de la division) ! Tous les heats ont été notés.');
            // We still proceed to onCloseHeat to update UI state
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Validation failsafe error:', err);
      // Continue anyway if validation fails (fallback)
    }

    // Vérifier les juges qui travaillent beaucoup
    const overworkedJudges = Object.entries(judgeWorkCount)
      .filter(([, count]) => count >= 4)
      .map(([judgeId, count]) => `${config.judgeNames[judgeId] || judgeId} (${count + 1} heats)`);

    if (overworkedJudges.length > 0) {
      const message = `⚠️ ATTENTION: Ces juges vont faire leur 5ème heat consécutif ou plus:\n\n${overworkedJudges.join('\n')}\n\nConsidérez une rotation des juges pour éviter la fatigue.`;
      alert(message);
    }

    onCloseHeat();
  };

  const surferScoredWaves = React.useMemo(() => {
    if (!selectedSurfer) return [];
    // Récupérer toutes les vagues notées pour ce surfeur (tous juges confondus)
    const waves = new Set(scores
      .filter(s => s.surfer === selectedSurfer && ensureHeatId(s.heat_id) === heatId)
      .map(s => s.wave_number)
    );
    return Array.from(waves).sort((a, b) => a - b);
  }, [scores, selectedSurfer, heatId]);

  const handleResetAllData = () => {
    console.log('🗑️ RESET COMPLET DEPUIS ADMIN...');
    onResetAllData();
  };



  const exportData = () => {
    const data = {
      config,
      timer,
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surf-judging-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportEventPdf = async () => {
    if (!isSupabaseConfigured()) {
      alert('Supabase n\'est pas configuré pour exporter l\'événement.');
      return;
    }
    const eventIdRaw = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_EVENT_STORAGE_KEY) : null;
    const eventId = eventIdRaw ? Number(eventIdRaw) : NaN;
    if (!eventId || Number.isNaN(eventId)) {
      alert('Aucun événement actif trouvé. Chargez un événement avant export.');
      return;
    }

    setEventPdfPending(true);
    try {
      // Fetch ALL categories and ALL heats for the event
      const allDivisions = await fetchAllEventHeats(eventId);

      if (!Object.keys(allDivisions).length) {
        alert('Aucune structure de heats trouvée pour cet événement.');
        return;
      }

      // Fetch ALL scores for ALL heats
      const allScores = await fetchAllScoresForEvent(eventId);

      // Get event details (organizer, date) if available
      let organizer: string | undefined;
      let eventDate: string | undefined;

      if (supabase) {
        const { data: eventData } = await supabase
          .from('events')
          .select('organizer, start_date')
          .eq('id', eventId)
          .single();

        if (eventData) {
          organizer = eventData.organizer ?? undefined;
          eventDate = eventData.start_date
            ? new Date(eventData.start_date).toLocaleDateString('fr-FR', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
            : undefined;
        }
      }

      // Export complete competition PDF
      exportFullCompetitionPDF({
        eventName: config.competition || 'Compétition',
        organizer,
        date: eventDate,
        divisions: allDivisions,
        scores: allScores,
      });

      console.log('✅ PDF complet généré avec', Object.keys(allDivisions).length, 'catégories');
    } catch (error) {
      console.error('Impossible de générer le PDF complet', error);
      alert('Impossible de générer le PDF complet pour le moment.');
    } finally {
      setEventPdfPending(false);
    }
  };

  const handleExportPdf = () => {
    try {
      exportHeatScorecardPdf({ config, scores });
    } catch (error) {
      console.error('Impossible de générer le PDF du heat:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Statut de la base de données */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Database className="w-5 h-5 text-gray-600" />
            <span className="font-medium text-gray-900">Statut de la base de données</span>
          </div>
          <div className="flex items-center space-x-2">
            {dbStatus === 'checking' && (
              <>
                <Wifi className="w-4 h-4 text-yellow-500 animate-pulse" />
                <span className="text-sm text-yellow-600">Vérification...</span>
              </>
            )}
            {dbStatus === 'connected' && (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600">Connecté</span>
              </>
            )}
            {dbStatus === 'disconnected' && (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">Déconnecté</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Configuration principale */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="absolute top-4 right-4">
          <button
            type="button"
            onClick={handleOpenDisplay}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Affichage
          </button>
        </div>
        <div className="flex items-center space-x-3 mb-6">
          <Settings className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-900">Configuration de la Compétition</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => navigate('/my-events')}
              className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            >
              ← Mes événements
            </button>
            <button
              onClick={() => {
                if (confirm('🧹 Nettoyer toutes les données et recommencer ?')) {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }
              }}
              className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
            >
              🧹 Reset Complet
            </button>
          </div>
        </div>

        {loadState === 'loading' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <RotateCcw className="h-4 w-4 animate-spin" />
            <span>Chargement de la configuration en cours…</span>
          </div>
        )}

        {loadState === 'loaded' && loadedFromDb && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle className="h-4 w-4" />
            <span>✅ Config chargée depuis la base.</span>
          </div>
        )}

        {loadState === 'loaded' && !loadedFromDb && loadError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" />
            <span>{loadError}</span>
          </div>
        )}

        {loadState === 'empty' && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="h-4 w-4" />
            <span>⚠️ Aucune configuration trouvée — veuillez la créer.</span>
          </div>
        )}

        {loadState === 'error' && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Erreur lors du chargement de la configuration&nbsp;: {loadError ?? 'Veuillez réessayer.'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom de la compétition
            </label>
            <input
              type="text"
              value={config.competition}
              onChange={(e) => handleConfigChange('competition', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Championnat de France"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Division
            </label>
            <input
              type="text"
              list="division-options"
              value={config.division}
              onChange={(e) => handleConfigChange('division', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Division auto-remplie"
            />
            <datalist id="division-options">
              {(divisionOptions.length ? divisionOptions : (availableDivisions.length ? availableDivisions : DEFAULT_DIVISIONS)).map((division) => (
                <option key={division} value={division} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Round</label>
            <input
              type="number"
              min="1"
              value={config.round}
              onChange={(e) => handleConfigChange('round', parseInt(e.target.value) || 1)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Heat #</label>
            <input
              type="number"
              min="1"
              value={config.heatId}
              onChange={(e) => handleConfigChange('heatId', parseInt(e.target.value) || 1)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vagues</label>
            <input
              type="number"
              min="1"
              max="20"
              value={config.waves}
              onChange={(e) => handleConfigChange('waves', parseInt(e.target.value) || 15)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Sélection des Juges FSS */}
        <JudgeSelectorSection
          selectedJudgeIds={config.judges}
          onSelectJudges={handleJudgesSelection}
          maxJudges={5}
        />

        {/* Surfeurs (lecture seule depuis Supabase) */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700">Surfeurs du heat</label>
          <div className="mt-1 mb-4 flex items-start space-x-2 text-sm text-gray-600">
            <InfoIcon className="w-4 h-4 text-gray-500 mt-0.5" />
            <p>
              Cette liste est synchronisée automatiquement à partir des heats planifiés dans la base.
              Modifiez les participants directement dans l’outil de planification si nécessaire.
            </p>
          </div>

          {config.surfers.length ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {config.surfers.map((surfer, index) => {
                const color = SURFER_COLOR_MAP[surfer as keyof typeof SURFER_COLOR_MAP] ?? '#6b7280';
                return (
                  <div key={`${surfer}-${index}`} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                    <div
                      className="w-4 h-4 rounded-full border border-gray-300"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm font-medium text-gray-900">{surfer}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              Aucun surfeur détecté pour ce heat. Vérifiez les entrées dans Supabase puis rechargez la configuration.
            </div>
          )}
        </div>

        <button
          onClick={handleSaveConfig}
          disabled={configSaved || loadState === 'loading'}
          className={`w-full py-3 px-4 rounded-lg font-medium text-lg transition-colors ${configSaved
            ? 'bg-emerald-100 text-emerald-700 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          {configSaved ? '✅ Configuration sauvegardée' : 'Sauvegarder la configuration'}
        </button>

      </div>

      {/* Timer */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Clock className="w-6 h-6 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900">Timer du Heat</h2>
        </div>
        <HeatTimer
          key={`timer-${config.competition}-${config.division}-R${config.round}-H${config.heatId}`}
          timer={timer}
          onStart={handleTimerStart}
          onPause={handleTimerPause}
          onReset={handleTimerReset}
          onDurationChange={handleTimerDurationChange}
          configSaved={configSaved}
        />
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Eye className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Affichage public</h2>
            <p className="text-sm text-gray-600">
              Ouvrez ou partagez le tableau de scores en temps réel sur un autre écran.
            </p>
          </div>
        </div>
        {publicDisplayUrl ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleOpenDisplay}
              className="w-full py-2 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
            >
              Ouvrir l’affichage public
            </button>
            <button
              type="button"
              onClick={handleCopyDisplayLink}
              className="w-full py-2 px-4 rounded-lg border border-blue-200 text-blue-700 font-medium hover:bg-blue-50 transition-colors"
            >
              {displayLinkCopied ? 'Lien copié ✅' : 'Copier le lien'}
            </button>
            <div className="text-xs text-gray-500 break-all bg-gray-50 p-3 rounded border border-gray-200">
              {publicDisplayUrl}
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-600">
            Impossible de générer le lien pour l’instant. Sauvegardez la configuration puis réessayez.
          </p>
        )}
      </div>

      {/* Close Heat */}
      {configSaved && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Gestion du Heat</h2>
                <p className="text-sm text-gray-600">
                  Heat actuel: {config.competition} - {config.division} - R{config.round} H{config.heatId}
                </p>
              </div>
            </div>

            <button
              onClick={handleCloseHeat}
              className="flex items-center space-x-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-lg transform transition hover:scale-105"
            >
              <CheckCircle className="w-5 h-5" />
              <span>Fermer le Heat</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {/* DEBUG PANEL */}
            <div className="mt-4 p-4 bg-gray-100 rounded text-xs font-mono text-gray-600 overflow-auto max-h-40">
              <p className="font-bold mb-1">🔧 DEBUG INFO:</p>
              <p>Heat: {config.competition} / {config.division} / R{config.round} H{config.heatId}</p>
              <p>Surfers: {config.surfers.join(', ')}</p>
              <p>Loaded from DB: {loadedFromDb ? 'YES' : 'NO'}</p>
              <button
                onClick={async () => {
                  try {
                    const eventId = await fetchEventIdByName(config.competition);
                    if (eventId) {
                      const seq = await fetchOrderedHeatSequence(eventId, config.division);
                      console.log('🔥 Heat Sequence:', seq);
                      alert(`Sequence Length: ${seq.length}\nSee console for details.`);
                    } else {
                      alert('Event ID not found');
                    }
                  } catch (e) { alert('Error: ' + e); }
                }}
                className="mt-2 px-2 py-1 bg-gray-300 rounded hover:bg-gray-400"
              >
                Inspect Sequence
              </button>
            </div>
          </div>

          {/* Statistiques des juges */}
          {Object.keys(judgeWorkCount).length > 0 && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Heats consécutifs par juge:</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {Object.entries(judgeWorkCount).map(([judgeId, count]) => (
                  <div key={judgeId} className={`flex items-center justify-between p-2 rounded ${count >= 4 ? 'bg-red-100 text-red-800' :
                    count >= 3 ? 'bg-orange-100 text-orange-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                    <span className="text-sm font-medium">
                      {config.judgeNames[judgeId] || judgeId}
                    </span>
                    <span className="text-sm font-bold">{count}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                🟢 Normal • 🟠 Attention (3+) • 🔴 Fatigue (4+)
              </p>
            </div>
          )}
        </div>
      )}

      {/* Paramètres avancés */}
      <div className="bg-white rounded-lg shadow p-6">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-medium text-gray-900">Paramètres avancés</h3>
          </div>
          <span className="text-gray-400">{showAdvanced ? '−' : '+'}</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={onReloadData}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Recharger</span>
              </button>

              <button
                onClick={handleResetAllData}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-bold"
              >
                <Trash2 className="w-4 h-4" />
                <span>🚀 RESET NUCLÉAIRE</span>
              </button>

              <button
                onClick={handleExportPdf}
                className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <FileText className="w-4 h-4" />
                <span>Export PDF</span>
              </button>

              <button
                onClick={handleExportEventPdf}
                disabled={eventPdfPending}
                className={`flex items-center space-x-2 px-4 py-2 rounded-md text-white ${eventPdfPending
                  ? 'bg-purple-300 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700'
                  }`}
              >
                <FileText className="w-4 h-4" />
                <span>{eventPdfPending ? 'Export évènement…' : 'Export complet (PDF)'}</span>
              </button>

              <button
                onClick={exportData}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                <span>Export JSON</span>
              </button>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Code Secret (PIN) pour les Juges
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={config.secretKey || ''}
                  onChange={(e) => handleConfigChange('secretKey', e.target.value)}
                  placeholder="Ex: 1234"
                  className="w-full md:w-1/3 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500">
                  Définissez un code simple (ex: 1234) pour permettre aux juges de se connecter sans email.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mode Kiosque - Liens Tablettes */}
      {configSaved && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Users className="w-6 h-6 text-purple-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Mode Kiosque - Tablettes</h2>
              <p className="text-sm text-gray-600">Liens directs pour tablettes J1 à J5</p>
            </div>
          </div>
          <div className="space-y-2">
            {["J1", "J2", "J3", "J4", "J5"].map(position => {
              const eventIdRaw = typeof window !== 'undefined' ? window.localStorage.getItem('surfJudgingActiveEventId') : null;
              const eventId = eventIdRaw ? Number(eventIdRaw) : null;
              const kioskUrl = eventId
                ? `${window.location.origin}/judge?position=${position}&eventId=${eventId}`
                : `${window.location.origin}/judge?position=${position}`;
              return (
                <div key={position} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">{position.replace("J", "")}</div>
                  <input value={kioskUrl} readOnly className="flex-1 px-2 py-1 text-xs font-mono border rounded" />
                  <button onClick={() => navigator.clipboard.writeText(kioskUrl)} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded">Copier</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Override Chef Juge */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <button
          onClick={() => setShowOverridePanel(!showOverridePanel)}
          className="flex items-center justify-between w-full mb-4"
        >
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <ClipboardCheck className="w-5 h-5 mr-2 text-amber-500" /> Correction de notes
          </h2>
          {!configSaved && <span className="text-sm text-red-600">Configuration non sauvegardée</span>}
        </button>

        {showOverridePanel && (
          <form className="space-y-4" onSubmit={handleOverrideSubmit}>
            {/* Juge selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Juge</label>
                <select
                  value={selectedJudge}
                  onChange={(e) => { setSelectedJudge(e.target.value); setOverrideStatus(null); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">Sélectionner un juge</option>
                  {config.judges.map((judgeId) => (
                    <option key={judgeId} value={judgeId}>
                      {config.judgeNames[judgeId] || judgeId}
                    </option>
                  ))}
                </select>
              </div>

              {/* Surfer selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Surfeur</label>
                <select
                  value={selectedSurfer}
                  onChange={(e) => { setSelectedSurfer(e.target.value); setOverrideStatus(null); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">Sélectionner un surfeur</option>
                  {config.surfers.map((surfer) => (
                    <option key={surfer} value={surfer}>{surfer}</option>
                  ))}
                </select>
              </div>

              {/* Wave selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vague</label>
                <select
                  value={selectedWave}
                  onChange={(e) => { setSelectedWave(Number(e.target.value)); setOverrideStatus(null); }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                >
                  <option value="">Sélectionner une vague</option>
                  {surferScoredWaves.length > 0 ? (
                    surferScoredWaves.map((wave) => (
                      <option key={wave} value={wave}>Vague {wave}</option>
                    ))
                  ) : (
                    // Fallback to all waves if no scored waves found (covers Omission case for 1st wave)
                    Array.from({ length: config.waves }, (_, i) => i + 1).map((wave) => (
                      <option key={wave} value={wave}>Vague {wave}</option>
                    ))
                  )}
                </select>
                {surferScoredWaves.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">Seules les vagues notées sont affichées.</p>
                )}
              </div>

              {/* Score input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nouvelle note</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={scoreInput}
                  onChange={(e) => { setScoreInput(e.target.value); setOverrideStatus(null); }}
                  placeholder="0.00"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
            </div>

            {currentScore && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span>
                  Note actuelle : <strong>{currentScore.score.toFixed(2)}</strong> donnée par {currentScore.judge_name} pour {currentScore.surfer} (Vague {currentScore.wave_number})
                </span>
              </div>
            )}

            {/* Reason + Comment */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motif</label>
                <select
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value as any)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  {Object.keys(reasonLabels).map((r) => (
                    <option key={r} value={r}>{reasonLabels[r as keyof typeof reasonLabels]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Commentaire</label>
                <input
                  type="text"
                  value={overrideComment}
                  onChange={(e) => setOverrideComment(e.target.value)}
                  placeholder="Optionnel"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>

            {overrideStatus && (
              <div className={`rounded-lg px-4 py-3 text-sm ${overrideStatus.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                {overrideStatus.message}
              </div>
            )}

            <button
              type="submit"
              disabled={overridePending || !configSaved}
              className={`px-4 py-2 rounded-lg font-medium text-white ${overridePending ? 'bg-gray-400' : 'bg-amber-600 hover:bg-amber-700'
                } ${!configSaved ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {overridePending ? 'Application…' : 'Appliquer la correction'}
            </button>
          </form>
        )}
      </div>

      {/* Historique des corrections */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Historique des overrides</h3>
        {overrideLogs.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune correction enregistrée pour ce heat.</p>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
            {overrideLogs.map(log => (
              <div key={log.id} className="border border-gray-200 rounded-lg px-4 py-3 text-sm bg-gray-50">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-900">{config.judgeNames[log.judge_id] || log.judge_name}</span>
                  <span className="text-xs text-gray-500">{new Date(log.created_at).toLocaleTimeString('fr-FR')}</span>
                </div>
                <div className="mt-1 text-gray-700">
                  {log.surfer} · Vague {log.wave_number}
                </div>
                <div className="mt-1 text-gray-700">
                  <span className="font-semibold">{reasonLabels[log.reason]}</span> — {log.previous_score !== null ? `ancien ${log.previous_score.toFixed(2)} → ` : ''}{log.new_score.toFixed(2)}
                </div>
                {log.comment && (
                  <div className="mt-1 text-gray-500 italic">{log.comment}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div >
  );
};

export default AdminInterface;
