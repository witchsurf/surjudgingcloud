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

    let judges = event.judges as any[];
    if (!Array.isArray(judges)) judges = [];

    const existingIndex = judges.findIndex((j: any) =>
        (typeof j === 'string' && j === judgeId) ||
        (typeof j === 'object' && j.id === judgeId)
    );

    if (existingIndex >= 0) {
        if (typeof judges[existingIndex] === 'string') {
            judges[existingIndex] = { id: judgeId, name };
        } else {
            judges[existingIndex] = { ...judges[existingIndex], name };
        }
    } else {
        judges.push({ id: judgeId, name });
    }

    const { error: updateError } = await supabase!
        .from('events')
        .update({ judges })
        .eq('id', eventId);

    if (updateError) throw updateError;
}
