import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api';

export interface Judge {
    id: string;
    name: string;
    personal_code: string;
    email?: string | null;
    phone?: string | null;
    certification_level?: string | null;
    federation: string;
    active: boolean;
    created_at: string;
}

export type LegacyEventJudge =
    | string
    | {
        id: string;
        name?: string;
        identity_id?: string;
    };

export function parseLegacyEventJudges(value: unknown): LegacyEventJudge[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is LegacyEventJudge => {
        if (typeof entry === 'string') return true;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const row = entry as Record<string, unknown>;
        return typeof row.id === 'string'
            && (row.name === undefined || typeof row.name === 'string')
            && (row.identity_id === undefined || typeof row.identity_id === 'string');
    });
}

export function updateLegacyEventJudgeDisplayName(
    value: unknown,
    judgeId: string,
    name: string,
): LegacyEventJudge[] {
    const judges = parseLegacyEventJudges(value);
    const existingIndex = judges.findIndex((judge) =>
        (typeof judge === 'string' && judge === judgeId)
        || (typeof judge === 'object' && judge.id === judgeId)
    );
    if (existingIndex < 0) return [...judges, { id: judgeId, name }];
    const existing = judges[existingIndex];
    const replacement: LegacyEventJudge = typeof existing === 'string'
        ? { id: judgeId, name }
        : { ...existing, name };
    return judges.map((judge, index) => index === existingIndex ? replacement : judge);
}

export async function fetchActiveJudges(): Promise<Judge[]> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('judges')
        .select('*')
        .eq('active', true)
        .order('name');

    if (error) throw error;
    return data || [];
}

export async function fetchJudgeById(judgeId: string): Promise<Judge | null> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('judges')
        .select('*')
        .eq('id', judgeId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

export async function validateJudgeCode(judgeId: string, personalCode: string): Promise<Judge | null> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('judges')
        .select('*')
        .eq('id', judgeId)
        .eq('personal_code', personalCode)
        .eq('active', true)
        .maybeSingle();

    if (error) return null;
    return data;
}

export async function createJudge(payload: {
    name: string;
    personal_code: string;
    email?: string;
    phone?: string;
    certification_level?: string;
    federation?: string;
}): Promise<Judge> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('judges')
        .insert({
            ...payload,
            federation: payload.federation || 'FSS',
            active: true
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateJudge(judgeId: string, payload: Partial<Omit<Judge, 'id' | 'created_at'>>): Promise<Judge> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('judges')
        .update(payload)
        .eq('id', judgeId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function deactivateJudge(judgeId: string): Promise<void> {
    ensureSupabase();
    const { error } = await supabase!
        .from('judges')
        .update({ active: false })
        .eq('id', judgeId);

    if (error) throw error;
}

export async function updateJudgeName(eventId: number, judgeId: string, name: string): Promise<void> {
    ensureSupabase();
    const { data: event, error: fetchError } = await supabase!
        .from('events')
        .select('judges')
        .eq('id', eventId)
        .single();

    if (fetchError) throw fetchError;

    const judges = updateLegacyEventJudgeDisplayName(event.judges, judgeId, name);

    const { error: updateError } = await supabase!
        .from('events')
        .update({ judges })
        .eq('id', eventId);

    if (updateError) throw updateError;
}
