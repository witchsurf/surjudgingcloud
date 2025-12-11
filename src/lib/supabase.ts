import { createClient } from '@supabase/supabase-js';

type EnvSource = Record<string, string | undefined>;

const resolveEnv = (key: string): string | undefined => {
  const importMetaEnv =
    typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: EnvSource })?.env
      ? (import.meta as unknown as { env: EnvSource }).env
      : undefined;
  if (importMetaEnv && key in importMetaEnv) {
    return importMetaEnv[key];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] ?? process.env[key.replace(/^VITE_/, '')];
  }
  return undefined;
};

const supabaseUrl = resolveEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = resolveEnv('VITE_SUPABASE_ANON_KEY');

// Petite aide au debug : on log les valeurs de config (sans afficher la clé en clair)
if (typeof window !== 'undefined') {
  console.log('[Supabase] VITE_SUPABASE_URL =', supabaseUrl);
  console.log(
    '[Supabase] VITE_SUPABASE_ANON_KEY present =',
    !!supabaseAnonKey && supabaseAnonKey !== 'undefined'
  );
  console.log('[Supabase] VITE_SITE_URL =', resolveEnv('VITE_SITE_URL'));
}

const hasValidEnv =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  supabaseUrl !== 'undefined' &&
  supabaseAnonKey !== 'undefined';

// Créer le client Supabase seulement si les variables d'environnement sont valides
export const supabase = hasValidEnv ? createClient(supabaseUrl, supabaseAnonKey) : null;

// Fonction pour vérifier si Supabase est configuré
export const isSupabaseConfigured = () => {
  return !!(hasValidEnv && supabase);
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
