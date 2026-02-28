import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api';
import { ensureHeatId } from '../../utils/heat';
import type { InterferenceCall, InterferenceType, Score } from '../../types';

const INTERFERENCE_CACHE_TTL_MS = 1500;
const interferenceCache = new Map<string, { at: number; value: InterferenceCall[] }>();
const interferenceInflight = new Map<string, Promise<InterferenceCall[]>>();

export type RawScoreRow = {
    id?: string;
    event_id?: number;
    heat_id: string;
    competition: string;
    division: string;
    round: number;
    judge_id: string;
    judge_name: string;
    surfer: string;
    wave_number: number;
    score: number;
    timestamp?: string;
    created_at?: string;
};

export const normalizeScoreJudgeId = (judgeId?: string) => {
    const upper = (judgeId || '').trim().toUpperCase();
    if (upper === 'KIOSK-J1') return 'J1';
    if (upper === 'KIOSK-J2') return 'J2';
    if (upper === 'KIOSK-J3') return 'J3';
    return upper || judgeId || '';
};

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

export const toParsedScore = (row: RawScoreRow): Score => ({
    id: row.id,
    event_id: row.event_id,
    heat_id: ensureHeatId(row.heat_id),
    competition: row.competition,
    division: row.division,
    round: row.round,
    judge_id: normalizeScoreJudgeId(row.judge_id),
    judge_name: normalizeScoreJudgeId(row.judge_name),
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
        const key = `${score.heat_id}::${normalizeScoreJudgeId(score.judge_id)}::${normalizeScoreSurfer(score.surfer)}::${Number(score.wave_number)}`;
        const existing = latestByLogicalKey.get(key);
        if (!existing || scoreTimestampMs(score) >= scoreTimestampMs(existing)) {
            latestByLogicalKey.set(key, score);
        }
    });
    return Array.from(latestByLogicalKey.values()).sort((a, b) => scoreTimestampMs(a) - scoreTimestampMs(b));
};

export async function fetchHeatScores(heatId: string): Promise<Score[]> {
    ensureSupabase();
    const normalizedHeatId = ensureHeatId(heatId);
    const { data, error } = await supabase!
        .from('scores')
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
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
    const { data, error } = await supabase!
        .from('scores')
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
        .in('heat_id', normalizedIds)
        .order('created_at', { ascending: true });

    if (error) throw error;
    const grouped: Record<string, Score[]> = {};
    ((data ?? []) as RawScoreRow[]).forEach((row) => {
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

    const { data: scores, error: scoresError } = await supabase!
        .from('scores')
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp, created_at')
        .in('heat_id', heatIds)
        .order('created_at', { ascending: true });

    if (scoresError) throw scoresError;
    const result: Record<string, Score[]> = {};
    ((scores ?? []) as RawScoreRow[]).forEach((row) => {
        const parsed = toParsedScore(row);
        if (!result[parsed.heat_id]) result[parsed.heat_id] = [];
        result[parsed.heat_id].push(parsed);
    });
    Object.keys(result).forEach((heatId) => {
        result[heatId] = canonicalizeScores(result[heatId]);
    });
    return result;
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
            .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
            .eq('heat_id', normalizedHeatId)
            .order('updated_at', { ascending: false });

        if (error) throw error;
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

    const { data: calls, error: callsError } = await supabase!
        .from('interference_calls')
        .select('id, event_id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, call_type, is_head_judge_override, created_at, updated_at')
        .in('heat_id', heatIds);

    if (callsError) throw callsError;
    const result: Record<string, InterferenceCall[]> = {};
    (calls ?? []).forEach((call) => {
        const key = ensureHeatId((call as InterferenceCall).heat_id);
        if (!result[key]) result[key] = [];
        result[key].push(call as InterferenceCall);
    });
    return result;
}

export async function upsertInterferenceCall(input: {
    event_id?: number | null; heat_id: string; competition?: string; division?: string; round?: number;
    judge_id: string; judge_name?: string; surfer: string; wave_number: number; call_type: InterferenceType;
    is_head_judge_override?: boolean;
}): Promise<void> {
    ensureSupabase();
    const payload = {
        event_id: input.event_id ?? null, heat_id: ensureHeatId(input.heat_id), competition: input.competition ?? null,
        division: input.division ?? null, round: input.round ?? null, judge_id: input.judge_id,
        judge_name: input.judge_name ?? null, surfer: input.surfer, wave_number: input.wave_number,
        call_type: input.call_type, is_head_judge_override: Boolean(input.is_head_judge_override),
    };
    const { error } = await supabase!.from('interference_calls').upsert(payload, { onConflict: 'heat_id,judge_id,surfer,wave_number' });
    if (error) throw error;
    interferenceCache.delete(payload.heat_id);
}
