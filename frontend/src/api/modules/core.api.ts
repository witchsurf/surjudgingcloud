import { supabase, isSupabaseConfigured } from '../../lib/supabase';

export const ensureSupabase = () => {
    if (!supabase || !isSupabaseConfigured()) {
        throw new Error('Supabase n\'est pas configuré.');
    }
};
