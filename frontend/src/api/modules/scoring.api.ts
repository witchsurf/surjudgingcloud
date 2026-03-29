import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api';
import { ensureHeatId } from '../../utils/heat';
import type { InterferenceCall, InterferenceType, Score } from '../../types';

const INTERFERENCE_CACHE_TTL_MS = 1500;
const SUPABASE_PAGE_SIZE = 1000;
const interferenceCache = new Map<string, { at: number; value: InterferenceCall[] }>();
const interferenceInflight = new Map<string, Promise<InterferenceCall[]>>();

const isMissingViewError = (error: unknown, viewName: string) => {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
        code?: string;
        message?: string;
        details?: string;
        status?: number;
        statusCode?: number;
        hint?: string;
    };
    const text = [
        candidate.code,
        candidate.message,
        candidate.details,
        candidate.hint,
        String(candidate.status ?? ''),
        String(candidate.statusCode ?? ''),
        JSON.stringify(candidate),
    ].join(' ').toLowerCase();
    return text.includes(viewName.toLowerCase()) && (text.includes('404') || text.includes('not found') || text.includes('pgrst'));
};

const isMissingInterferenceTableError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
        code?: string;
        message?: string;
        details?: string;
        status?: number;
        statusCode?: number;
        hint?: string;
    };
    const text = [
        candidate.code,
        candidate.message,
        candidate.details,
        candidate.hint,
        String(candidate.status ?? ''),
        String(candidate.statusCode ?? ''),
        JSON.stringify(candidate),
    ].join(' ').toLowerCase();
    return text.includes('interference_calls') && (text.includes('404') || text.includes('not found') || text.includes('pgrst'));
};

export type RawScoreRow = {
    id?: string;
    event_id?: number;
    heat_id: string;
    competition: string;
    division: string;
    round: number;
    judge_id: string;
    judge_name: string;
    judge_station?: string | null;
    judge_identity_id?: string | null;
    surfer: string;
    wave_number: number;
    score: number;
    timestamp?: string;
    created_at?: string;
};

export type CanonicalScoreViewRow = RawScoreRow & {
    judge_station: string;
    judge_identity_id?: string | null;
    judge_display_name?: string | null;
};

export type EventJudgeAssignmentCoverageRow = {
    event_id: number;
    competition: string;
    division: string;
    round: number;
    heat_number: number;
    heat_id: string;
    expected_station_count: number;
    assigned_station_count: number;
    missing_station_count: number;
    is_complete: boolean;
};

export type EventJudgeAccuracySummaryRow = {
    event_id: number;
    judge_identity_id: string;
    judge_display_name: string;
    scored_waves: number;
    consensus_samples: number;
    mean_abs_deviation: number;
    bias: number;
    within_half_point_rate: number;
    override_count: number;
    override_rate: number;
    average_override_delta: number;
    quality_score: number;
    quality_band: 'excellent' | 'good' | 'watch' | 'needs_review';
};

export type HeatMissingScoreSlotRow = {
    event_id: number;
    heat_id: string;
    judge_station: string;
    judge_identity_id?: string | null;
    judge_display_name: string;
    surfer: string;
    wave_number: number;
};

export type HeatCloseValidationResult = {
    heat_id: string;
    event_id: number;
    has_any_scores: boolean;
    started_wave_count: number;
    missing_score_count: number;
    pending_slots: HeatMissingScoreSlotRow[];
};

export const normalizeScoreJudgeId = (judgeId?: string) => {
    const upper = (judgeId || '').trim().toUpperCase();
    if (upper === 'KIOSK-J1') return 'J1';
    if (upper === 'KIOSK-J2') return 'J2';
    if (upper === 'KIOSK-J3') return 'J3';
    return upper || judgeId || '';
};

export const normalizeScoreJudgeName = (judgeName?: string) => {
    return (judgeName || '').trim();
};

export const getScoreJudgeStation = (score: Pick<Score, 'judge_station' | 'judge_id'>) =>
    normalizeScoreJudgeStation(score.judge_station, score.judge_id);

export const getScoreJudgeIdentity = (score: Pick<Score, 'judge_identity_id' | 'judge_id'>) =>
    (score.judge_identity_id || '').trim() || normalizeScoreJudgeId(score.judge_id);

export const getScoreJudgeDisplayName = (score: Pick<Score, 'judge_name' | 'judge_identity_id' | 'judge_id'>) =>
    normalizeScoreJudgeName(score.judge_name) || getScoreJudgeIdentity(score);

export const SCORE_SURFER_MAP: Record<string, string> = {
    RED: 'RED', ROUGE: 'RED',
    WHITE: 'WHITE', BLANC: 'WHITE',
    YELLOW: 'YELLOW', JAUNE: 'YELLOW',
    BLUE: 'BLUE', BLEU: 'BLUE',
    GREEN: 'GREEN', VERT: 'GREEN',
    BLACK: 'BLACK', NOIR: 'BLACK',
};

export const normalizeScoreSurfer = (surfer?: string) => {
    const upper = (surfer || '').trim().toUpperCase();
    return SCORE_SURFER_MAP[upper] || upper || surfer || '';
};

export const scoreTimestampMs = (score: Score) => new Date(score.created_at || score.timestamp || 0).getTime();

export const normalizeScoreJudgeStation = (judgeStation?: string, judgeId?: string) => {
    return normalizeScoreJudgeId(judgeStation || judgeId);
};

export const toParsedScore = (row: RawScoreRow): Score => ({
    id: row.id,
    event_id: row.event_id,
    heat_id: ensureHeatId(row.heat_id),
    competition: row.competition,
    division: row.division,
    round: row.round,
    judge_id: normalizeScoreJudgeId(row.judge_id),
    judge_name: normalizeScoreJudgeName(row.judge_name) || normalizeScoreJudgeId(row.judge_id),
    judge_station: normalizeScoreJudgeStation(row.judge_station, row.judge_id),
    judge_identity_id: (row.judge_identity_id || '').trim() || undefined,
    surfer: normalizeScoreSurfer(row.surfer),
    wave_number: row.wave_number,
    score: typeof row.score === 'number' ? row.score : Number(row.score) || 0,
    timestamp: row.timestamp ?? new Date().toISOString(),
    created_at: row.created_at ?? undefined,
    synced: true,
});

export const canonicalizeScores = (scores: Score[]): Score[] => {
    const latestByLogicalKey = new Map<string, Score>();
    scores.forEach((score) => {
        const judgeStation = normalizeScoreJudgeStation(score.judge_station, score.judge_id);
        const key = `${score.heat_id}::${judgeStation}::${normalizeScoreSurfer(score.surfer)}::${Number(score.wave_number)}`;
        const existing = latestByLogicalKey.get(key);
        if (!existing || scoreTimestampMs(score) >= scoreTimestampMs(existing)) {
            latestByLogicalKey.set(key, score);
        }
    });
    return Array.from(latestByLogicalKey.values()).sort((a, b) => scoreTimestampMs(a) - scoreTimestampMs(b));
};

async function fetchPagedScoreRows(heatIds: string[]): Promise<RawScoreRow[]> {
    const rows: RawScoreRow[] = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await supabase!
            .from('scores')
            .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, judge_identity_id, surfer, wave_number, score, timestamp, created_at')
            .in('heat_id', heatIds)
            .order('created_at', { ascending: true })
            .range(from, to);

        if (error) throw error;

        const batch = (data ?? []) as RawScoreRow[];
        rows.push(...batch);

        if (batch.length < SUPABASE_PAGE_SIZE) break;
        from += SUPABASE_PAGE_SIZE;
    }

    return rows;
}

async function fetchPagedInterferenceRows(heatIds: string[]): Promise<InterferenceCall[]> {
    const rows: InterferenceCall[] = [];
    let from = 0;

    while (true) {
        const to = from + SUPABASE_PAGE_SIZE - 1;
        const { data, error } = await supabase!
            .from('interference_calls')
            .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, judge_identity_id, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
            .in('heat_id', heatIds)
            .range(from, to);

        if (error) {
            if (isMissingInterferenceTableError(error)) {
                console.warn('⚠️ Table interference_calls absente localement, export PDF sans interférences.');
                return [];
            }
            throw error;
        }

        const batch = (data ?? []) as InterferenceCall[];
        rows.push(...batch);

        if (batch.length < SUPABASE_PAGE_SIZE) break;
        from += SUPABASE_PAGE_SIZE;
    }

    return rows;
}

export async function fetchHeatScores(heatId: string): Promise<Score[]> {
    ensureSupabase();
    const normalizedHeatId = ensureHeatId(heatId);
    const { data, error } = await supabase!
            .from('scores')
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, judge_identity_id, surfer, wave_number, score, timestamp, created_at')
        .eq('heat_id', normalizedHeatId)
        .order('created_at', { ascending: true });

    if (error) throw error;
    const rows = (data ?? []) as RawScoreRow[];
    return canonicalizeScores(rows.map(toParsedScore));
}

export async function fetchScoresForHeats(heatIds: string[]): Promise<Record<string, Score[]>> {
    ensureSupabase();
    if (!heatIds.length) return {};

    const normalizedIds = Array.from(new Set(heatIds.map((id) => ensureHeatId(id))));
    const grouped: Record<string, Score[]> = {};
    (await fetchPagedScoreRows(normalizedIds)).forEach((row) => {
        const parsed = toParsedScore(row);
        if (!grouped[parsed.heat_id]) grouped[parsed.heat_id] = [];
        grouped[parsed.heat_id].push(parsed);
    });
    Object.keys(grouped).forEach((heatId) => {
        grouped[heatId] = canonicalizeScores(grouped[heatId]);
    });
    return grouped;
}

export async function fetchAllScoresForEvent(eventId: number): Promise<Record<string, Score[]>> {
    ensureSupabase();
    const { data: heats, error: heatsError } = await supabase!.from('heats').select('id').eq('event_id', eventId);
    if (heatsError) throw heatsError;
    const heatIds = (heats ?? []).map((h) => h.id);
    if (!heatIds.length) return {};

    const result: Record<string, Score[]> = {};
    (await fetchPagedScoreRows(heatIds)).forEach((row) => {
        const parsed = toParsedScore(row);
        if (!result[parsed.heat_id]) result[parsed.heat_id] = [];
        result[parsed.heat_id].push(parsed);
    });
    Object.keys(result).forEach((heatId) => {
        result[heatId] = canonicalizeScores(result[heatId]);
    });
    return result;
}

export async function fetchCanonicalScoresForEvent(eventId: number): Promise<Record<string, Score[]>> {
    ensureSupabase();
    const { data: heats, error: heatsError } = await supabase!
        .from('heats')
        .select('id')
        .eq('event_id', eventId);

    if (heatsError) throw heatsError;

    const heatIds = (heats ?? []).map((row) => ensureHeatId(row.id));
    if (!heatIds.length) return {};

    const { data, error } = await supabase!
        .from('v_scores_canonical_enriched')
        .select('id, event_id, heat_id, competition, division, round, judge_identity_id, judge_station, judge_display_name, surfer, wave_number, score, timestamp, created_at')
        .in('heat_id', heatIds)
        .order('heat_id', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) {
        if (isMissingViewError(error, 'v_scores_canonical_enriched')) {
            throw new Error('VIEW_NOT_READY:v_scores_canonical_enriched');
        }
        throw error;
    }

    const result: Record<string, Score[]> = {};
    ((data ?? []) as CanonicalScoreViewRow[]).forEach((row) => {
        const parsed = toParsedScore({
            ...row,
            judge_id: row.judge_identity_id || row.judge_id,
            judge_name: row.judge_display_name || row.judge_name,
        });
        if (!result[parsed.heat_id]) result[parsed.heat_id] = [];
        result[parsed.heat_id].push(parsed);
    });
    Object.keys(result).forEach((heatId) => {
        result[heatId] = canonicalizeScores(result[heatId]);
    });
    return result;
}

export async function fetchPreferredScoresForEvent(eventId: number): Promise<Record<string, Score[]>> {
    try {
        return await fetchCanonicalScoresForEvent(eventId);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('VIEW_NOT_READY:')) {
            return fetchAllScoresForEvent(eventId);
        }
        throw error;
    }
}

export async function fetchEventJudgeAssignmentCoverage(eventId: number): Promise<EventJudgeAssignmentCoverageRow[]> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('v_event_judge_assignment_coverage')
        .select('*')
        .eq('event_id', eventId)
        .order('division', { ascending: true })
        .order('round', { ascending: true })
        .order('heat_number', { ascending: true });

    if (error) {
        if (isMissingViewError(error, 'v_event_judge_assignment_coverage')) {
            throw new Error('VIEW_NOT_READY:v_event_judge_assignment_coverage');
        }
        throw error;
    }

    return (data ?? []) as EventJudgeAssignmentCoverageRow[];
}

export async function fetchEventJudgeAccuracySummary(eventId: number): Promise<EventJudgeAccuracySummaryRow[]> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('v_event_judge_accuracy_summary')
        .select('*')
        .eq('event_id', eventId)
        .order('quality_score', { ascending: false })
        .order('mean_abs_deviation', { ascending: true });

    if (error) {
        if (isMissingViewError(error, 'v_event_judge_accuracy_summary')) {
            throw new Error('VIEW_NOT_READY:v_event_judge_accuracy_summary');
        }
        throw error;
    }

    return (data ?? []) as EventJudgeAccuracySummaryRow[];
}

export async function fetchHeatMissingScoreSlots(heatId: string): Promise<HeatMissingScoreSlotRow[]> {
    ensureSupabase();
    const normalizedHeatId = ensureHeatId(heatId);
    const { data, error } = await supabase!
        .from('v_heat_missing_score_slots')
        .select('*')
        .eq('heat_id', normalizedHeatId)
        .order('judge_display_name', { ascending: true })
        .order('surfer', { ascending: true })
        .order('wave_number', { ascending: true });

    if (error) {
        if (isMissingViewError(error, 'v_heat_missing_score_slots')) {
            throw new Error('VIEW_NOT_READY:v_heat_missing_score_slots');
        }
        throw error;
    }

    return (data ?? []) as HeatMissingScoreSlotRow[];
}

export async function fetchHeatCloseValidation(heatId: string): Promise<HeatCloseValidationResult | null> {
    ensureSupabase();
    const normalizedHeatId = ensureHeatId(heatId);
    const { data, error } = await supabase!
        .rpc('fn_get_heat_close_validation', { p_heat_id: normalizedHeatId });

    if (error) {
        if (isMissingViewError(error, 'fn_get_heat_close_validation') || String((error as { message?: string })?.message || '').includes('fn_get_heat_close_validation')) {
            throw new Error('FUNCTION_NOT_READY:fn_get_heat_close_validation');
        }
        throw error;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;

    return {
        heat_id: row.heat_id,
        event_id: row.event_id,
        has_any_scores: Boolean(row.has_any_scores),
        started_wave_count: Number(row.started_wave_count) || 0,
        missing_score_count: Number(row.missing_score_count) || 0,
        pending_slots: Array.isArray(row.pending_slots) ? row.pending_slots : [],
    } as HeatCloseValidationResult;
}

export async function fetchInterferenceCalls(heatId: string): Promise<InterferenceCall[]> {
    ensureSupabase();
    const normalizedHeatId = ensureHeatId(heatId);
    const cached = interferenceCache.get(normalizedHeatId);
    if (cached && Date.now() - cached.at < INTERFERENCE_CACHE_TTL_MS) return cached.value;

    const inflight = interferenceInflight.get(normalizedHeatId);
    if (inflight) return inflight;

    const request = (async () => {
        const { data, error } = await supabase!
            .from('interference_calls')
            .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station, judge_identity_id, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
            .eq('heat_id', normalizedHeatId)
            .order('updated_at', { ascending: false });

        if (error) {
            if (isMissingInterferenceTableError(error)) {
                console.warn('⚠️ Table interference_calls absente localement, interférences ignorées.');
                const empty: InterferenceCall[] = [];
                interferenceCache.set(normalizedHeatId, { at: Date.now(), value: empty });
                return empty;
            }
            throw error;
        }
        const value = (data ?? []) as InterferenceCall[];
        interferenceCache.set(normalizedHeatId, { at: Date.now(), value });
        return value;
    })();

    interferenceInflight.set(normalizedHeatId, request);
    try { return await request; } finally { interferenceInflight.delete(normalizedHeatId); }
}

export async function fetchAllInterferenceCallsForEvent(eventId: number): Promise<Record<string, InterferenceCall[]>> {
    ensureSupabase();
    const { data: heats, error: heatsError } = await supabase!.from('heats').select('id').eq('event_id', eventId);
    if (heatsError) throw heatsError;
    const heatIds = (heats ?? []).map((h) => h.id);
    if (!heatIds.length) return {};

    const result: Record<string, InterferenceCall[]> = {};
    (await fetchPagedInterferenceRows(heatIds)).forEach((call) => {
        const key = ensureHeatId((call as InterferenceCall).heat_id);
        if (!result[key]) result[key] = [];
        result[key].push(call as InterferenceCall);
    });
    return result;
}

export async function upsertInterferenceCall(input: {
    event_id?: number | null; heat_id: string; competition?: string; division?: string; round?: number;
    judge_id: string; judge_name?: string; judge_station?: string; judge_identity_id?: string; surfer: string; wave_number: number; call_type: InterferenceType;
    is_head_judge_override?: boolean;
}): Promise<void> {
    ensureSupabase();
    const payload = {
        event_id: input.event_id ?? null, heat_id: ensureHeatId(input.heat_id), competition: input.competition ?? null,
        division: input.division ?? null, round: input.round ?? null, judge_id: input.judge_id,
        judge_name: input.judge_name ?? null, judge_station: input.judge_station ?? input.judge_id,
        judge_identity_id: input.judge_identity_id ?? null, surfer: input.surfer, wave_number: input.wave_number,
        call_type: input.call_type, is_head_judge_override: Boolean(input.is_head_judge_override),
    };
    const { error } = await supabase!.from('interference_calls').upsert(payload, { onConflict: 'heat_id,judge_id,surfer,wave_number' });
    if (error) {
        if (isMissingInterferenceTableError(error)) {
            console.warn('⚠️ Table interference_calls absente localement, sauvegarde interférence ignorée.');
            return;
        }
        throw error;
    }
    interferenceCache.delete(payload.heat_id);
}
