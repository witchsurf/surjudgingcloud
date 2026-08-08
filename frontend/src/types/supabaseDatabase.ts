// Compatibility alias kept during P2 so existing Supabase client imports do
// not change before repository and consumer migration is approved.
export type {
  Database as SupabaseDatabase,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from './supabase.generated';
