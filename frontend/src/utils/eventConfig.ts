import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getCachedCloudParticipants } from './syncCloudEvents';
import { isDevMode } from '../lib/offlineAuth';

/**
 * Get the first category from participants for an event
 * Used for auto-configuring division when loading event for first time
 */
export async function getFirstCategoryFromParticipants(eventId: number): Promise<string | null> {
    // In dev/offline mode, try cached participants first
    if (isDevMode() || !isSupabaseConfigured() || !supabase) {
        const cachedParticipants = getCachedCloudParticipants(eventId);
        if (cachedParticipants.length > 0) {
            console.log('📴 Using cached participants for first category');
            return cachedParticipants[0]?.category || null;
        }
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('participants')
            .select('category')
            .eq('event_id', eventId)
            .order('seed', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('Error fetching first category:', error);
            return null;
        }

        return data?.category || null;
    } catch (err) {
        console.error('Failed to get first category:', err);
        return null;
    }
}

/**
 * Get all distinct categories for an event from participants
 */
export async function getEventCategories(eventId: number): Promise<string[]> {
    // In dev/offline mode, try cached participants first
    if (isDevMode() || !isSupabaseConfigured() || !supabase) {
        const cachedParticipants = getCachedCloudParticipants(eventId);
        if (cachedParticipants.length > 0) {
            console.log('📴 Using cached participants for categories');
            const categories = Array.from(new Set(
                cachedParticipants
                    .map(p => p.category?.trim())
                    .filter(Boolean)
            )) as string[];
            return categories;
        }
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('participants')
            .select('category')
            .eq('event_id', eventId)
            .order('category', { ascending: true });

        if (error) {
            console.error('Error fetching categories:', error);
            return [];
        }

        // Get unique categories
        const categories = Array.from(new Set(
            (data || [])
                .map(p => p.category?.trim())
                .filter(Boolean)
        )) as string[];

        return categories;
    } catch (err) {
        console.error('Failed to get event categories:', err);
        return [];
    }
}
