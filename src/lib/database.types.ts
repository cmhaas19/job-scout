export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      config_audit_log: {
        Row: {
          changed_at: string | null
          changed_by: string
          config_key: string
          id: string
          new_value: Json
          old_value: Json | null
        }
        Insert: {
          changed_at?: string | null
          changed_by: string
          config_key: string
          id?: string
          new_value: Json
          old_value?: Json | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string
          config_key?: string
          id?: string
          new_value?: Json
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "config_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_evaluations: {
        Row: {
          ago_time: string | null
          archived: boolean
          company: string
          company_logo: string | null
          created_at: string | null
          date_posted: string | null
          description: string | null
          eval_summary: string | null
          fit_category: string | null
          gaps: Json | null
          id: string
          job_url: string
          location: string | null
          position: string
          prompt_version: number | null
          salary: string | null
          score_details: Json | null
          search_id: string | null
          search_query: string | null
          skip_reason: string | null
          skipped: boolean | null
          strengths: Json | null
          total_score: number | null
          updated_at: string | null
          user_id: string
          user_notes: string | null
          user_rating: number | null
        }
        Insert: {
          ago_time?: string | null
          archived?: boolean
          company: string
          company_logo?: string | null
          created_at?: string | null
          date_posted?: string | null
          description?: string | null
          eval_summary?: string | null
          fit_category?: string | null
          gaps?: Json | null
          id?: string
          job_url: string
          location?: string | null
          position: string
          prompt_version?: number | null
          salary?: string | null
          score_details?: Json | null
          search_id?: string | null
          search_query?: string | null
          skip_reason?: string | null
          skipped?: boolean | null
          strengths?: Json | null
          total_score?: number | null
          updated_at?: string | null
          user_id: string
          user_notes?: string | null
          user_rating?: number | null
        }
        Update: {
          ago_time?: string | null
          archived?: boolean
          company?: string
          company_logo?: string | null
          created_at?: string | null
          date_posted?: string | null
          description?: string | null
          eval_summary?: string | null
          fit_category?: string | null
          gaps?: Json | null
          id?: string
          job_url?: string
          location?: string | null
          position?: string
          prompt_version?: number | null
          salary?: string | null
          score_details?: Json | null
          search_id?: string | null
          search_query?: string | null
          skip_reason?: string | null
          skipped?: boolean | null
          strengths?: Json | null
          total_score?: number | null
          updated_at?: string | null
          user_id?: string
          user_notes?: string | null
          user_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_evaluations_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "saved_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_evaluations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          email_digest_enabled: boolean
          full_name: string | null
          id: string
          resume_text: string | null
          resume_uploaded_at: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          email_digest_enabled?: boolean
          full_name?: string | null
          id: string
          resume_text?: string | null
          resume_uploaded_at?: string | null
          role?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          email_digest_enabled?: boolean
          full_name?: string | null
          id?: string
          resume_text?: string | null
          resume_uploaded_at?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          prompt_id: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          prompt_id: string
          version: number
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          prompt_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "system_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      run_logs: {
        Row: {
          cancel_requested: boolean
          created_at: string | null
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          last_heartbeat_at: string | null
          search_id: string | null
          started_at: string
          stats: Json | null
          status: string
          trigger_type: string
          user_id: string
        }
        Insert: {
          cancel_requested?: boolean
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          last_heartbeat_at?: string | null
          search_id?: string | null
          started_at: string
          stats?: Json | null
          status: string
          trigger_type: string
          user_id: string
        }
        Update: {
          cancel_requested?: boolean
          created_at?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          last_heartbeat_at?: string | null
          search_id?: string | null
          started_at?: string
          stats?: Json | null
          status?: string
          trigger_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_logs_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "saved_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          created_at: string | null
          date_since_posted: string
          experience_level: string[] | null
          id: string
          is_active: boolean | null
          job_type: string | null
          keyword: string
          location: string | null
          name: string
          remote_filter: string | null
          result_limit: number | null
          sort_by: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date_since_posted?: string
          experience_level?: string[] | null
          id?: string
          is_active?: boolean | null
          job_type?: string | null
          keyword: string
          location?: string | null
          name: string
          remote_filter?: string | null
          result_limit?: number | null
          sort_by?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date_since_posted?: string
          experience_level?: string[] | null
          id?: string
          is_active?: boolean | null
          job_type?: string | null
          keyword?: string
          location?: string | null
          name?: string
          remote_filter?: string | null
          result_limit?: number | null
          sort_by?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_searches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_prompts: {
        Row: {
          content: string
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          content: string
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          content?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_prompts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
