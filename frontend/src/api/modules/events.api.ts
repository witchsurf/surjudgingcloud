import { supabase } from '../../lib/supabase';
import { ensureSupabase } from './core.api.ts';
import type { AppConfig } from '../../types';

export interface EventSummary {
    id: number;
    name: string;
    organizer?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    categories?: unknown;
    judges?: unknown;
    config?: unknown | null;
}

export interface EventConfigRecord {
    id: number;
    name: string;
    categories: string[];
    judges: Array<{ id: string; name?: string }>;
    config: Partial<AppConfig> | null;
}

export interface EventConfigSnapshot {
    event_id: number;
    event_name: string;
    division: string;
    round: number;
    heat_number: number;
    judges: Array<{ id: string; name?: string }>;
    surfers?: string[];
    heat_size?: number;
    surferNames?: Record<string, string>;
    surferCountries?: Record<string, string>;
    eventDetails?: { organizer?: string; date?: string };
    updated_at: string;
}

export async function fetchEvents(): Promise<EventSummary[]> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('events')
        .select('id, name, organizer, start_date, end_date, categories, judges, config')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) throw error;
    return (data ?? []) as EventSummary[];
}

export async function fetchLatestEventConfig(): Promise<EventConfigRecord | null> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('events')
        .select('id, name, categories, judges, config')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const categoriesRaw = Array.isArray(data.categories) ? data.categories : [];
    const categories = categoriesRaw
        .map((value) => {
            if (typeof value === 'string') return value;
            if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') {
                return value.name;
            }
            return null;
        })
        .filter((value): value is string => Boolean(value));

    const judgesRaw = Array.isArray(data.judges) ? data.judges : [];
    const judges = judgesRaw
        .map((value) => {
            if (typeof value === 'string') {
                return { id: value };
            }
            if (value && typeof value === 'object') {
                const maybeId = 'id' in value && typeof value.id === 'string' ? value.id : null;
                const maybeName = 'name' in value && typeof value.name === 'string' ? value.name : undefined;
                if (maybeId) {
                    return { id: maybeId, name: maybeName };
                }
            }
            return null;
        })
        .filter((value): value is { id: string; name?: string } => value !== null);

    const config = data.config && typeof data.config === 'object' ? (data.config as Partial<AppConfig>) : null;

    return {
        id: data.id,
        name: data.name,
        categories,
        judges,
        config,
    };
}

export async function updateEventConfiguration(eventId: number, payload: {
    config: AppConfig;
    divisions: string[];
    judges: Array<{ id: string; name?: string }>;
}): Promise<void> {
    ensureSupabase();
    const { config, divisions, judges } = payload;

    const storedConfig: Partial<AppConfig> = {
        ...config,
        judgeNames: config.judgeNames,
    };

    const { error } = await supabase!
        .from('events')
        .update({
            name: config.competition,
            categories: divisions,
            judges,
            config: storedConfig,
        })
        .eq('id', eventId);

    if (error) throw error;
}

export async function fetchDistinctDivisions(eventId?: number): Promise<string[]> {
    ensureSupabase();

    let builder = supabase!
        .from('v_event_divisions')
        .select('division')
        .order('division', { ascending: true });

    if (eventId) {
        builder = builder.eq('event_id', eventId);
    }

    const { data, error } = await builder;

    if (error) throw error;

    const divisions = (data ?? [])
        .map((row: { division: string | null }) => row.division ?? '')
        .filter((value): value is string => Boolean(value));

    if (divisions.length > 0 || !eventId) {
        return divisions;
    }

    const fallback = await supabase!
        .from('participants')
        .select('division')
        .eq('event_id', eventId)
        .order('division', { ascending: true });

    if (fallback.error) throw fallback.error;

    return Array.from(
        new Set(
            (fallback.data ?? [])
                .map((row: { division: string | null }) => row.division ?? '')
                .filter((value): value is string => Boolean(value))
        )
    );
}

export async function fetchEventConfigSnapshot(eventId: number): Promise<EventConfigSnapshot | null> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('event_last_config')
        .select('event_id, event_name, division, round, heat_number, judges, updated_at')
        .eq('event_id', eventId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const judgesPayload = Array.isArray(data.judges)
        ? (data.judges as Array<{ id?: string; name?: string }>)
            .map((judge) => {
                if (typeof judge === 'string') {
                    return { id: judge, name: judge };
                }
                if (judge && typeof judge === 'object' && typeof judge.id === 'string') {
                    return { id: judge.id, name: judge.name ?? judge.id };
                }
                return null;
            })
            .filter((value): value is { id: string; name: string } => Boolean(value))
        : [];

    let surfers: string[] | undefined;
    let heatSize: number | undefined;
    let surferNames: Record<string, string> | undefined;
    let surferCountries: Record<string, string> | undefined;

    try {
        const { data: heatData } = await supabase!
            .from('heats')
            .select('id, heat_size, heat_entries(position, color, seed, participant:participants(name, country))')
            .eq('event_id', eventId)
            .eq('division', data.division)
            .eq('round', data.round)
            .eq('heat_number', data.heat_number)
            .maybeSingle();

        if (heatData) {
            heatSize = heatData.heat_size ?? undefined;
            const entries = (heatData.heat_entries as any[] | null) || [];
            if (entries.length > 0) {
                const sortedEntries = entries
                    .filter((entry: any) => entry.color)
                    .sort((a: any, b: any) => (a.position || 0) - (b.position || 0));

                surfers = Array.from(new Set(sortedEntries.map((entry: any) => {
                    const color = entry.color?.toString().toUpperCase();
                    return color || '';
                }).filter(Boolean)));

                surferNames = {};
                surferCountries = {};
                sortedEntries.forEach((entry: any) => {
                    const color = entry.color?.toString().toUpperCase();
                    if (color && entry.participant) {
                        if (entry.participant.name) {
                            surferNames![color] = entry.participant.name;
                        }
                        if (entry.participant.country) {
                            surferCountries![color] = entry.participant.country;
                        }
                    }
                });
            }
        }
    } catch (err) {
        console.warn('Could not fetch heat structure:', err);
    }

    let eventDetails: { organizer?: string; date?: string } | undefined;
    try {
        const { data: eventData } = await supabase!
            .from('events')
            .select('organizer, start_date')
            .eq('id', eventId)
            .maybeSingle();

        if (eventData) {
            eventDetails = {
                organizer: eventData.organizer,
                date: eventData.start_date ? new Date(eventData.start_date).toLocaleDateString('fr-FR') : undefined,
            };
        }
    } catch (err) {
        console.warn('Could not fetch event details:', err);
    }

    return {
        event_id: data.event_id,
        event_name: data.event_name,
        division: data.division,
        round: data.round,
        heat_number: data.heat_number,
        judges: judgesPayload,
        surfers,
        heat_size: heatSize,
        surferNames,
        surferCountries,
        eventDetails,
        updated_at: data.updated_at,
    };
}

export async function saveEventConfigSnapshot(payload: {
    eventId: number;
    eventName: string;
    division: string;
    round: number;
    heatNumber: number;
    judges: Array<{ id: string; name?: string }>;
}): Promise<void> {
    ensureSupabase();

    const judgePayload = payload.judges.map((judge) => ({
        id: judge.id,
        name: judge.name ?? judge.id,
    }));

    const { error } = await supabase!.rpc('upsert_event_last_config', {
        p_event_id: payload.eventId,
        p_event_name: payload.eventName,
        p_division: payload.division,
        p_round: payload.round,
        p_heat_number: payload.heatNumber,
        p_judges: judgePayload,
    });

    if (error) throw error;
}

export async function ensureEventExists(eventName: string): Promise<number> {
    ensureSupabase();
    const { data: existing, error: fetchError } = await supabase!
        .from('events')
        .select('id')
        .eq('name', eventName)
        .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
    if (existing) return existing.id;

    const { data: newEvent, error: createError } = await supabase!
        .from('events')
        .insert({
            name: eventName,
            organizer: 'Auto-created',
            start_date: new Date().toISOString().split('T')[0],
            end_date: new Date().toISOString().split('T')[0],
            price: 0
        })
        .select('id')
        .single();

    if (createError) throw createError;
    return newEvent.id;
}

export async function fetchEventIdByName(name: string): Promise<number | null> {
    ensureSupabase();
    const { data, error } = await supabase!
        .from('events')
        .select('id')
        .eq('name', name)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) return null;
    return data?.id || null;
}
