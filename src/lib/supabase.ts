import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Créer le client Supabase seulement si les variables d'environnement sont valides
export const supabase = supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined'
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Fonction pour vérifier si Supabase est configuré
export const isSupabaseConfigured = () => {
  return !!(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined' && supabase);
};

// Types pour la base de données
export interface DatabaseHeat {
  id: string;
  competition: string;
  division: string;
  round: number;
  heat_number: number;
  status: 'open' | 'closed';
  created_at: string;
  closed_at?: string;
}

export interface DatabaseScore {
  id: string;
  heat_id: string;
  competition: string;
  division: string;
  round: number;
  judge_id: string;
  judge_name: string;
  surfer: string;
  wave_number: number;
  score: number;
  timestamp: string;
  created_at: string;
  synced: boolean;
}