import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api';
import type { ParsedParticipant } from '../../utils/csv';

export interface ParticipantRecord extends ParsedParticipant {
    id: number;
    event_id: number;
}

export async function fetchParticipants(eventId: number): Promise<ParticipantRecord[]> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('participants')
        .select('id, event_id, category, seed, name, country, license')
        .eq('event_id', eventId)
        .order('category', { ascending: true })
        .order('seed', { ascending: true });

    if (error) throw error;
    return (data ?? []) as ParticipantRecord[];
}

export async function upsertParticipants(eventId: number, rows: ParsedParticipant[]) {
    ensureSupabase();
    if (!rows.length) return;

    const payload = rows.map((row) => ({
        event_id: eventId,
        category: row.category,
        seed: row.seed,
        name: row.name,
        country: row.country ?? null,
        license: row.license ?? null,
    }));

    const { error } = await supabase!
        .from('participants')
        .upsert(payload, { onConflict: 'event_id,category,seed' });

    if (error) throw error;
}

export async function updateParticipant(id: number, patch: Partial<ParsedParticipant>) {
    ensureSupabase();
    const { error } = await supabase!
        .from('participants')
        .update({
            name: patch.name,
            country: patch.country,
            license: patch.license,
            seed: patch.seed,
            category: patch.category,
        })
        .eq('id', id);

    if (error) throw error;
}

export async function deleteParticipant(id: number) {
    ensureSupabase();
    const { error } = await supabase!.from('participants').delete().eq('id', id);
    if (error) throw error;
}
