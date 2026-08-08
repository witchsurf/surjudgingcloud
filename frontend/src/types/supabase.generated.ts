export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      active_heat_pointer: {
        Row: {
          active_heat_id: string | null
          event_id: number | null
          event_name: string
          podium_id: string
          updated_at: string | null
        }
        Insert: {
          active_heat_id?: string | null
          event_id?: number | null
          event_name: string
          podium_id?: string
          updated_at?: string | null
        }
        Update: {
          active_heat_id?: string | null
          event_id?: number | null
          event_name?: string
          podium_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "active_heat_pointer_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_heat_pointer_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "active_heat_pointer_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      app_runtime_schema_version: {
        Row: {
          id: boolean
          schema_label: string | null
          schema_version: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          schema_label?: string | null
          schema_version: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          schema_label?: string | null
          schema_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      competition_audit_log: {
        Row: {
          action_type: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_id: number | null
          heat_id: string | null
          id: string
          metadata: Json
          podium_id: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_id?: number | null
          heat_id?: string | null
          id?: string
          metadata?: Json
          podium_id?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_id?: number | null
          heat_id?: string | null
          id?: string
          metadata?: Json
          podium_id?: string | null
        }
        Relationships: []
      }
      event_last_config: {
        Row: {
          division: string
          event_id: number
          event_name: string
          heat_number: number
          judges: Json
          round: number
          surfer_countries: Json | null
          surfer_names: Json | null
          surfers: string[] | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          division: string
          event_id: number
          event_name: string
          heat_number?: number
          judges?: Json
          round?: number
          surfer_countries?: Json | null
          surfer_names?: Json | null
          surfers?: string[] | null
          updated_at?: string
          updated_by?: string
        }
        Update: {
          division?: string
          event_id?: number
          event_name?: string
          heat_number?: number
          judges?: Json
          round?: number
          surfer_countries?: Json | null
          surfer_names?: Json | null
          surfers?: string[] | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_last_config_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_last_config_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_last_config_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      events: {
        Row: {
          categories: Json
          config: Json | null
          created_at: string
          currency: string
          end_date: string
          id: number
          judges: Json
          method: string | null
          name: string
          organizer: string
          paid: boolean
          paid_at: string | null
          payment_ref: string | null
          price: number
          start_date: string
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          categories?: Json
          config?: Json | null
          created_at?: string
          currency?: string
          end_date: string
          id?: number
          judges?: Json
          method?: string | null
          name: string
          organizer: string
          paid?: boolean
          paid_at?: string | null
          payment_ref?: string | null
          price: number
          start_date: string
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          categories?: Json
          config?: Json | null
          created_at?: string
          currency?: string
          end_date?: string
          id?: number
          judges?: Json
          method?: string | null
          name?: string
          organizer?: string
          paid?: boolean
          paid_at?: string | null
          payment_ref?: string | null
          price?: number
          start_date?: string
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      heat_configs: {
        Row: {
          created_at: string | null
          heat_id: string
          id: string
          judge_names: Json | null
          judges: string[]
          surfers: string[]
          tournament_type: string | null
          waves: number | null
        }
        Insert: {
          created_at?: string | null
          heat_id: string
          id?: string
          judge_names?: Json | null
          judges: string[]
          surfers: string[]
          tournament_type?: string | null
          waves?: number | null
        }
        Update: {
          created_at?: string | null
          heat_id?: string
          id?: string
          judge_names?: Json | null
          judges?: string[]
          surfers?: string[]
          tournament_type?: string | null
          waves?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "heat_configs_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_configs_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_configs_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_configs_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
      heat_entries: {
        Row: {
          color: string | null
          created_at: string
          heat_id: string | null
          id: number
          participant_id: number | null
          position: number
          seed: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          heat_id?: string | null
          id?: number
          participant_id?: number | null
          position: number
          seed: number
        }
        Update: {
          color?: string | null
          created_at?: string
          heat_id?: string | null
          id?: number
          participant_id?: number | null
          position?: number
          seed?: number
        }
        Relationships: [
          {
            foreignKeyName: "heat_entries_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_entries_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_entries_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_entries_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_entries_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      heat_entry_overrides: {
        Row: {
          color: string | null
          created_at: string
          created_by: string
          event_id: number | null
          heat_id: string
          id: string
          new_country: string | null
          new_participant_id: number | null
          new_participant_name: string
          position: number
          previous_participant_id: number | null
          previous_participant_name: string | null
          reason: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string
          event_id?: number | null
          heat_id: string
          id?: string
          new_country?: string | null
          new_participant_id?: number | null
          new_participant_name: string
          position: number
          previous_participant_id?: number | null
          previous_participant_name?: string | null
          reason?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string
          event_id?: number | null
          heat_id?: string
          id?: string
          new_country?: string | null
          new_participant_id?: number | null
          new_participant_name?: string
          position?: number
          previous_participant_id?: number | null
          previous_participant_name?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      heat_history: {
        Row: {
          created_at: string | null
          duration_minutes: number | null
          end_time: string | null
          heat_id: string | null
          id: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          heat_id?: string | null
          id?: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          heat_id?: string | null
          id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "heat_history_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_history_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_history_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_history_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
      heat_judge_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          event_id: number | null
          heat_id: string
          id: string
          judge_id: string
          judge_name: string
          station: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          event_id?: number | null
          heat_id: string
          id?: string
          judge_id: string
          judge_name: string
          station: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          event_id?: number | null
          heat_id?: string
          id?: string
          judge_id?: string
          judge_name?: string
          station?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "heat_judge_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_judge_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "heat_judge_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "heat_judge_assignments_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_judge_assignments_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_judge_assignments_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_judge_assignments_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
      heat_realtime_config: {
        Row: {
          config_data: Json | null
          heat_id: string
          status: string
          timer_duration_minutes: number | null
          timer_start_time: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          config_data?: Json | null
          heat_id: string
          status?: string
          timer_duration_minutes?: number | null
          timer_start_time?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          config_data?: Json | null
          heat_id?: string
          status?: string
          timer_duration_minutes?: number | null
          timer_start_time?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      heat_slot_mappings: {
        Row: {
          created_at: string
          heat_id: string
          id: number
          placeholder: string | null
          position: number
          source_heat: number | null
          source_position: number | null
          source_round: number | null
        }
        Insert: {
          created_at?: string
          heat_id: string
          id?: number
          placeholder?: string | null
          position: number
          source_heat?: number | null
          source_position?: number | null
          source_round?: number | null
        }
        Update: {
          created_at?: string
          heat_id?: string
          id?: number
          placeholder?: string | null
          position?: number
          source_heat?: number | null
          source_position?: number | null
          source_round?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "heat_slot_mappings_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_slot_mappings_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_slot_mappings_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_slot_mappings_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
      heat_timers: {
        Row: {
          created_at: string | null
          duration_minutes: number | null
          heat_id: string
          id: string
          is_running: boolean | null
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          duration_minutes?: number | null
          heat_id: string
          id?: string
          is_running?: boolean | null
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          duration_minutes?: number | null
          heat_id?: string
          id?: string
          is_running?: boolean | null
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "heat_timers_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heat_timers_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_timers_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "heat_timers_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: true
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
      heats: {
        Row: {
          closed_at: string | null
          color_order: string[] | null
          competition: string
          created_at: string | null
          division: string
          event_id: number | null
          heat_number: number
          heat_size: number | null
          id: string
          is_active: boolean | null
          round: number
          status: string
          updated_at: string | null
        }
        Insert: {
          closed_at?: string | null
          color_order?: string[] | null
          competition: string
          created_at?: string | null
          division: string
          event_id?: number | null
          heat_number: number
          heat_size?: number | null
          id: string
          is_active?: boolean | null
          round: number
          status?: string
          updated_at?: string | null
        }
        Update: {
          closed_at?: string | null
          color_order?: string[] | null
          competition?: string
          created_at?: string | null
          division?: string
          event_id?: number | null
          heat_number?: number
          heat_size?: number | null
          id?: string
          is_active?: boolean | null
          round?: number
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      interference_calls: {
        Row: {
          call_type: string
          competition: string | null
          created_at: string
          division: string | null
          event_id: number | null
          heat_id: string
          id: number
          is_head_judge_override: boolean
          judge_id: string
          judge_identity_id: string | null
          judge_name: string | null
          judge_station: string | null
          round: number | null
          surfer: string
          updated_at: string
          wave_number: number
        }
        Insert: {
          call_type: string
          competition?: string | null
          created_at?: string
          division?: string | null
          event_id?: number | null
          heat_id: string
          id?: number
          is_head_judge_override?: boolean
          judge_id: string
          judge_identity_id?: string | null
          judge_name?: string | null
          judge_station?: string | null
          round?: number | null
          surfer: string
          updated_at?: string
          wave_number: number
        }
        Update: {
          call_type?: string
          competition?: string | null
          created_at?: string
          division?: string | null
          event_id?: number | null
          heat_id?: string
          id?: number
          is_head_judge_override?: boolean
          judge_id?: string
          judge_identity_id?: string | null
          judge_name?: string | null
          judge_station?: string | null
          round?: number | null
          surfer?: string
          updated_at?: string
          wave_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "interference_calls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interference_calls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "interference_calls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "interference_calls_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interference_calls_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "interference_calls_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "interference_calls_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
      materialized_view_refresh_queue: {
        Row: {
          last_refresh_requested_at: string
          last_refreshed_at: string | null
          view_name: string
        }
        Insert: {
          last_refresh_requested_at?: string
          last_refreshed_at?: string | null
          view_name: string
        }
        Update: {
          last_refresh_requested_at?: string
          last_refreshed_at?: string | null
          view_name?: string
        }
        Relationships: []
      }
      participants: {
        Row: {
          category: string
          country: string | null
          created_at: string
          event_id: number | null
          id: number
          license: string | null
          name: string
          seed: number
          updated_at: string | null
        }
        Insert: {
          category: string
          country?: string | null
          created_at?: string
          event_id?: number | null
          id?: number
          license?: string | null
          name: string
          seed: number
          updated_at?: string | null
        }
        Update: {
          category?: string
          country?: string | null
          created_at?: string
          event_id?: number | null
          id?: number
          license?: string | null
          name?: string
          seed?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          event_id: number | null
          id: number
          paid_at: string | null
          provider: string
          status: string
          transaction_ref: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          event_id?: number | null
          id?: number
          paid_at?: string | null
          provider: string
          status?: string
          transaction_ref?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          event_id?: number | null
          id?: number
          paid_at?: string | null
          provider?: string
          status?: string
          transaction_ref?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "payments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      podium_judge_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          event_id: number
          judge_id: string
          judge_name: string
          podium_id: string
          station: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          event_id: number
          judge_id: string
          judge_name: string
          podium_id: string
          station: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          event_id?: number
          judge_id?: string
          judge_name?: string
          podium_id?: string
          station?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "podium_judge_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podium_judge_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "podium_judge_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      score_deletions: {
        Row: {
          comment: string | null
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string | null
          event_id: number | null
          heat_id: string
          id: string
          judge_id: string
          judge_identity_id: string | null
          judge_name: string | null
          judge_station: string | null
          reason: string | null
          score: number
          score_id: string
          score_snapshot: Json
          surfer: string
          wave_number: number
        }
        Insert: {
          comment?: string | null
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          event_id?: number | null
          heat_id: string
          id?: string
          judge_id: string
          judge_identity_id?: string | null
          judge_name?: string | null
          judge_station?: string | null
          reason?: string | null
          score: number
          score_id: string
          score_snapshot: Json
          surfer: string
          wave_number: number
        }
        Update: {
          comment?: string | null
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          event_id?: number | null
          heat_id?: string
          id?: string
          judge_id?: string
          judge_identity_id?: string | null
          judge_name?: string | null
          judge_station?: string | null
          reason?: string | null
          score?: number
          score_id?: string
          score_snapshot?: Json
          surfer?: string
          wave_number?: number
        }
        Relationships: []
      }
      score_overrides: {
        Row: {
          comment: string | null
          created_at: string | null
          heat_id: string
          id: string
          judge_id: string
          judge_identity_id: string | null
          judge_name: string
          judge_station: string | null
          new_score: number
          overridden_by: string
          overridden_by_name: string
          previous_score: number | null
          reason: string
          score_id: string
          surfer: string
          wave_number: number
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          heat_id: string
          id?: string
          judge_id: string
          judge_identity_id?: string | null
          judge_name: string
          judge_station?: string | null
          new_score: number
          overridden_by?: string
          overridden_by_name?: string
          previous_score?: number | null
          reason: string
          score_id: string
          surfer: string
          wave_number: number
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          heat_id?: string
          id?: string
          judge_id?: string
          judge_identity_id?: string | null
          judge_name?: string
          judge_station?: string | null
          new_score?: number
          overridden_by?: string
          overridden_by_name?: string
          previous_score?: number | null
          reason?: string
          score_id?: string
          surfer?: string
          wave_number?: number
        }
        Relationships: []
      }
      scores: {
        Row: {
          competition: string
          created_at: string | null
          division: string
          event_id: number | null
          heat_id: string
          id: string
          judge_id: string
          judge_identity_id: string | null
          judge_name: string
          judge_station: string | null
          round: number
          score: number
          surfer: string
          timestamp: string
          wave_number: number
        }
        Insert: {
          competition: string
          created_at?: string | null
          division: string
          event_id?: number | null
          heat_id: string
          id: string
          judge_id: string
          judge_identity_id?: string | null
          judge_name: string
          judge_station?: string | null
          round: number
          score: number
          surfer: string
          timestamp: string
          wave_number: number
        }
        Update: {
          competition?: string
          created_at?: string | null
          division?: string
          event_id?: number | null
          heat_id?: string
          id?: string
          judge_id?: string
          judge_identity_id?: string | null
          judge_name?: string
          judge_station?: string | null
          round?: number
          score?: number
          surfer?: string
          timestamp?: string
          wave_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "scores_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "scores_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
    }
    Views: {
      v_current_heat: {
        Row: {
          division: string | null
          event_id: number | null
          event_name: string | null
          heat_id: string | null
          heat_number: number | null
          round: number | null
          status: string | null
        }
        Relationships: []
      }
      v_event_divisions: {
        Row: {
          division: string | null
          event_id: number | null
          event_name: string | null
        }
        Relationships: []
      }
      v_event_judge_accuracy_summary: {
        Row: {
          average_override_delta: number | null
          bias: number | null
          consensus_samples: number | null
          event_id: number | null
          judge_display_name: string | null
          judge_identity_id: string | null
          mean_abs_deviation: number | null
          override_count: number | null
          override_rate: number | null
          quality_band: string | null
          quality_score: number | null
          scored_waves: number | null
          within_half_point_rate: number | null
        }
        Relationships: []
      }
      v_event_judge_assignment_coverage: {
        Row: {
          assigned_station_count: number | null
          competition: string | null
          division: string | null
          event_id: number | null
          expected_station_count: number | null
          heat_id: string | null
          heat_number: number | null
          is_complete: boolean | null
          missing_station_count: number | null
          round: number | null
        }
        Relationships: [
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      v_heat_lineup: {
        Row: {
          country: string | null
          event_id: number | null
          heat_id: string | null
          jersey_color: string | null
          placeholder: string | null
          position: number | null
          seed: number | null
          source_heat: number | null
          source_position: number | null
          source_round: number | null
          surfer_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      v_heat_missing_score_slots: {
        Row: {
          event_id: number | null
          heat_id: string | null
          judge_display_name: string | null
          judge_identity_id: string | null
          judge_station: string | null
          surfer: string | null
          wave_number: number | null
        }
        Relationships: [
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_current_heat"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_divisions"
            referencedColumns: ["event_id"]
          },
        ]
      }
      v_scores_canonical_enriched: {
        Row: {
          competition: string | null
          created_at: string | null
          division: string | null
          event_id: number | null
          heat_id: string | null
          id: string | null
          judge_display_name: string | null
          judge_identity_id: string | null
          judge_station: string | null
          round: number | null
          score: number | null
          surfer: string | null
          timestamp: string | null
          wave_number: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_event_judge_assignment_coverage"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_lineup"
            referencedColumns: ["heat_id"]
          },
          {
            foreignKeyName: "scores_heat_id_fkey"
            columns: ["heat_id"]
            isOneToOne: false
            referencedRelation: "v_heat_missing_score_slots"
            referencedColumns: ["heat_id"]
          },
        ]
      }
    }
    Functions: {
      activate_heat_on_podium: {
        Args: {
          p_assigned_by?: string
          p_event_id: number
          p_heat_id: string
          p_podium_id: string
        }
        Returns: Json
      }
      admin_override_heat_entry: {
        Args: {
          p_color?: string
          p_country?: string
          p_created_by?: string
          p_heat_id: string
          p_name?: string
          p_participant_id?: number
          p_position: number
          p_reason?: string
        }
        Returns: Json
      }
      apply_score_correction_secure: {
        Args: {
          p_heat_id?: string
          p_log_comment?: string
          p_log_created_at?: string
          p_log_id?: string
          p_log_overridden_by?: string
          p_log_overridden_by_name?: string
          p_log_reason?: string
          p_score?: number
          p_score_id: string
          p_set_score?: boolean
          p_set_surfer?: boolean
          p_set_wave_number?: boolean
          p_surfer?: string
          p_timestamp?: string
          p_wave_number?: number
        }
        Returns: Json
      }
      assert_no_active_podium_judge_conflict: {
        Args: {
          p_active_heat_id: string
          p_event_id: number
          p_podium_id: string
        }
        Returns: undefined
      }
      bulk_sync_scores: { Args: { p_scores: Json }; Returns: undefined }
      bulk_upsert_heats:
        | {
            Args: {
              p_entries?: Json
              p_heats?: Json
              p_mappings?: Json
              p_participants?: Json
            }
            Returns: undefined
          }
        | {
            Args: {
              p_delete_ids?: string[]
              p_entries?: Json
              p_heats?: Json
              p_mappings?: Json
              p_participants?: Json
            }
            Returns: undefined
          }
      bulk_upsert_heats_safe: {
        Args: {
          p_category: string
          p_entries?: Json
          p_event_id: number
          p_heats?: Json
          p_mappings?: Json
          p_overwrite?: boolean
          p_participants?: Json
        }
        Returns: undefined
      }
      bulk_upsert_heats_safe_v2: {
        Args: {
          p_category: string
          p_entries?: Json
          p_event_id: number
          p_heat_configs?: Json
          p_heats?: Json
          p_mappings?: Json
          p_overwrite?: boolean
          p_participants?: Json
        }
        Returns: undefined
      }
      upsert_heat_config_runtime: {
        Args: {
          p_heat_id: string
          p_judge_names: Json
          p_judges: string[]
          p_surfers: string[]
          p_tournament_type: string
          p_waves: number
        }
        Returns: undefined
      }
      can_display_event: { Args: { p_event_id: number }; Returns: boolean }
      can_display_heat: { Args: { p_heat_id: string }; Returns: boolean }
      check_heat_planning_safety: {
        Args: {
          p_category: string
          p_event_id: number
          p_overwrite?: boolean
          p_proposed_heat_ids?: string[]
        }
        Returns: {
          active_pointer_count: number
          blocker_reasons: string[]
          heat_id: string
          history_count: number
          interference_count: number
          is_active: boolean
          judge_assignment_count: number
          override_count: number
          score_count: number
          status: string
          timer_count: number
        }[]
      }
      close_current_heat_and_open_next: { Args: never; Returns: undefined }
      close_heat_on_podium: {
        Args: {
          p_closed_by?: string
          p_event_id: number
          p_heat_id: string
          p_next_heat_id?: string
          p_podium_id: string
        }
        Returns: Json
      }
      close_heat_on_podium_strict: {
        Args: {
          p_closed_by?: string
          p_event_id: number
          p_force?: boolean
          p_force_reason?: string
          p_heat_id: string
          p_next_heat_id?: string
          p_podium_id: string
        }
        Returns: Json
      }
      copy_podium_panel_to_heat: {
        Args: {
          p_assigned_by?: string
          p_event_id: number
          p_heat_id: string
          p_podium_id: string
        }
        Returns: number
      }
      delete_score_secure: {
        Args: {
          p_comment?: string
          p_deleted_by?: string
          p_deleted_by_name?: string
          p_heat_id: string
          p_reason?: string
          p_score_id: string
        }
        Returns: Json
      }
      fn_audit_podium: {
        Args: { p_event_id: number; p_heat_id: string }
        Returns: string
      }
      fn_best_second_heat_entry_for_round: {
        Args: { p_division: string; p_event_id: number; p_round: number }
        Returns: {
          best_two: number
          color: string
          participant_id: number
          seed: number
          source_heat: number
        }[]
      }
      fn_get_event_operations_health: {
        Args: { p_event_id: number }
        Returns: Json
      }
      fn_get_heat_close_readiness: {
        Args: { p_heat_id: string }
        Returns: Json
      }
      fn_get_heat_close_validation: {
        Args: { p_heat_id: string }
        Returns: {
          event_id: number
          has_any_scores: boolean
          heat_id: string
          missing_score_count: number
          pending_slots: Json
          started_wave_count: number
        }[]
      }
      fn_heat_interference_summary: {
        Args: { p_heat_id: string }
        Returns: {
          interference_count: number
          interference_type: string
          is_disqualified: boolean
          surfer_color: string
        }[]
      }
      fn_infer_heat_slot_mappings_for_heat: {
        Args: { p_target_heat_id: string }
        Returns: {
          heat_id: string
          placeholder: string
          slot_position: number
          source_heat: number
          source_position: number
          source_round: number
        }[]
      }
      fn_normalize_heat_color_sql: {
        Args: { p_value: string }
        Returns: string
      }
      fn_normalize_jersey_label_sql: {
        Args: { p_value: string }
        Returns: string
      }
      fn_propagate_qualifiers_for_source_heat: {
        Args: { p_source_heat_id: string }
        Returns: number
      }
      fn_rank_heat_entries_from_scores: {
        Args: { p_heat_id: string }
        Returns: {
          best_two: number
          color: string
          participant_id: number
          rank_pos: number
          seed: number
        }[]
      }
      fn_resolve_canonical_heat_id: {
        Args: {
          p_competition?: string
          p_division?: string
          p_event_id?: number
          p_heat_id: string
          p_round?: number
        }
        Returns: string
      }
      get_active_priority:
        | {
            Args: never
            Returns: {
              heat_id: string
              priority_state: Json
              status: string
              surfers: Json
              timer_remaining_seconds: number
            }[]
          }
        | {
            Args: { p_event_id: number; p_podium_id?: string }
            Returns: {
              heat_id: string
              priority_state: Json
              status: string
              surfers: Json
              timer_remaining_seconds: number
            }[]
          }
        | {
            Args: { p_podium_id: string }
            Returns: {
              heat_id: string
              priority_state: Json
              status: string
              surfers: Json
              timer_remaining_seconds: number
            }[]
          }
      get_heat_planning_safety_inventory: {
        Args: {
          p_category: string
          p_event_id: number
          p_overwrite?: boolean
          p_proposed_heat_ids?: string[]
        }
        Returns: {
          active_pointer_count: number
          blocker_reasons: string[]
          heat_id: string
          history_count: number
          interference_count: number
          is_active: boolean
          judge_assignment_count: number
          override_count: number
          score_count: number
          status: string
          timer_count: number
        }[]
      }
      is_local_database: { Args: never; Returns: boolean }
      is_official_judge_assignment_id: {
        Args: { p_judge_id: string }
        Returns: boolean
      }
      rebuild_division_qualifiers_from_scores: {
        Args: { p_division: string; p_event_id: number }
        Returns: number
      }
      record_score_override_secure: {
        Args: {
          p_comment?: string
          p_created_at?: string
          p_heat_id: string
          p_id: string
          p_judge_id: string
          p_judge_identity_id?: string
          p_judge_name?: string
          p_judge_station?: string
          p_new_score?: number
          p_overridden_by?: string
          p_overridden_by_name?: string
          p_previous_score?: number
          p_reason?: string
          p_score_id: string
          p_surfer?: string
          p_wave_number?: number
        }
        Returns: Json
      }
      refresh_judge_accuracy_summary: { Args: never; Returns: undefined }
      set_podium_judge_panel: {
        Args: {
          p_assigned_by?: string
          p_assignments: Json
          p_event_id: number
          p_podium_id: string
        }
        Returns: number
      }
      upsert_active_heat_pointer:
        | {
            Args: {
              p_active_heat_id?: string
              p_event_id?: number
              p_event_name?: string
              p_updated_at?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_active_heat_id?: string
              p_event_id?: number
              p_event_name?: string
              p_podium_id?: string
              p_updated_at?: string
            }
            Returns: undefined
          }
      upsert_event_last_config:
        | {
            Args: {
              p_division: string
              p_event_id: number
              p_event_name: string
              p_heat_number: number
              p_judges: Json
              p_round: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_division: string
              p_event_id: number
              p_event_name: string
              p_heat_number: number
              p_judges: Json
              p_round: number
              p_surfer_countries?: Json
              p_surfer_names?: Json
              p_surfers?: string[]
            }
            Returns: undefined
          }
      upsert_heat_realtime_config: {
        Args: {
          p_config_data?: Json
          p_heat_id: string
          p_set_config_data?: boolean
          p_set_timer_duration?: boolean
          p_set_timer_start_time?: boolean
          p_status?: string
          p_timer_duration_minutes?: number
          p_timer_start_time?: string
          p_updated_by?: string
        }
        Returns: undefined
      }
      upsert_score_secure: {
        Args: {
          p_competition?: string
          p_created_at?: string
          p_division?: string
          p_event_id?: number
          p_heat_id?: string
          p_id: string
          p_judge_id?: string
          p_judge_identity_id?: string
          p_judge_name?: string
          p_judge_station?: string
          p_round?: number
          p_score?: number
          p_surfer?: string
          p_timestamp?: string
          p_wave_number?: number
        }
        Returns: Json
      }
      user_has_event_access: { Args: { p_event_id: number }; Returns: boolean }
      user_is_judge_for_heat: { Args: { p_heat_id: string }; Returns: boolean }
      validate_heat_start_dependencies: {
        Args: { p_heat_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
