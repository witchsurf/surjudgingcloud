// The project does not currently ship generated Supabase schema types.
// This loose schema keeps Supabase's generic client from collapsing table/RPC
// calls to `never` while preserving the existing runtime data flow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseValue = any;

type GenericTable = {
  Row: LooseValue;
  Insert: LooseValue;
  Update: LooseValue;
  Relationships: [];
};

type GenericFunction = {
  Args: Record<string, LooseValue>;
  Returns: LooseValue;
};

export type SupabaseDatabase = {
  public: {
    Tables: Record<string, GenericTable>;
    Views: Record<string, GenericTable>;
    Functions: Record<string, GenericFunction>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, Record<string, LooseValue>>;
  };
};
