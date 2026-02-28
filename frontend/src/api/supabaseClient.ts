// ----------------------------------------------------------------------------
// FACADE: supabaseClient.ts
// Ce fichier sert d'entrée centrale pour tout le front-end,
// redirigeant vers les modules spécifiques découpés.
// ----------------------------------------------------------------------------

export {
    supabase,
    isSupabaseConfigured,
    getSupabaseConfig,
    getSupabaseMode,
    setSupabaseMode,
    isCloudLocked,
    setCloudLocked
} from '../lib/supabase';

export { ensureSupabase } from './modules/core.api';

export {
    fetchEvents,
    fetchLatestEventConfig,
    updateEventConfiguration,
    fetchDistinctDivisions,
    fetchEventConfigSnapshot,
    saveEventConfigSnapshot,
    ensureEventExists,
    fetchEventIdByName
} from './modules/events.api';
export type { EventSummary, EventConfigRecord, EventConfigSnapshot } from './modules/events.api';

export {
    fetchParticipants,
    upsertParticipants,
    updateParticipant,
    deleteParticipant
} from './modules/participants.api';
export type { ParticipantRecord } from './modules/participants.api';

export {
    createHeatsWithEntries,
    deletePlannedHeats,
    fetchOrderedHeatSequence,
    fetchCategoryHeats,
    fetchAllEventCategories,
    fetchAllEventHeats,
    fetchActiveHeatPointer,
    parseActiveHeatId,
    subscribeToHeatUpdates,
    fetchHeatEntriesWithParticipants,
    fetchHeatSlotMappings,
    fetchHeatMetadata,
    replaceHeatEntries
} from './modules/heats.api';
export type { ActiveHeatPointer, HeatRow, HeatEntryRow, HeatSlotMappingRow, CreateHeatsOptions } from './modules/heats.api';

export {
    normalizeScoreJudgeId,
    SCORE_SURFER_MAP,
    normalizeScoreSurfer,
    scoreTimestampMs,
    toParsedScore,
    canonicalizeScores,
    fetchHeatScores,
    fetchScoresForHeats,
    fetchAllScoresForEvent,
    fetchInterferenceCalls,
    fetchAllInterferenceCallsForEvent,
    upsertInterferenceCall
} from './modules/scoring.api';
export type { RawScoreRow } from './modules/scoring.api';

export {
    fetchActiveJudges,
    fetchJudgeById,
    validateJudgeCode,
    createJudge,
    updateJudge,
    deactivateJudge,
    updateJudgeName
} from './modules/judges.api';
export type { Judge } from './modules/judges.api';
