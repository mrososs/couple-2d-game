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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      couple_members: {
        Row: {
          couple_id: string
          joined_at: string
          left_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          couple_id: string
          joined_at?: string
          left_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          couple_id?: string
          joined_at?: string
          left_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "couple_members_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      couples: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      game_rooms: {
        Row: {
          closed_at: string | null
          code: string
          couple_id: string
          created_at: string
          current_level_id: string
          expires_at: string
          id: string
          owner_id: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          code: string
          couple_id: string
          created_at?: string
          current_level_id: string
          expires_at?: string
          id?: string
          owner_id: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          code?: string
          couple_id?: string
          created_at?: string
          current_level_id?: string
          expires_at?: string
          id?: string
          owner_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_rooms_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_rooms_current_level_id_fkey"
            columns: ["current_level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      level_progress: {
        Row: {
          attempts: number
          best_duration_seconds: number | null
          completed_at: string | null
          completions: number
          couple_id: string
          first_completed_at: string | null
          level_id: string
          result: Json
          stars: number | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          best_duration_seconds?: number | null
          completed_at?: string | null
          completions?: number
          couple_id: string
          first_completed_at?: string | null
          level_id: string
          result?: Json
          stars?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          best_duration_seconds?: number | null
          completed_at?: string | null
          completions?: number
          couple_id?: string
          first_completed_at?: string | null
          level_id?: string
          result?: Json
          stars?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "level_progress_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "level_progress_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      levels: {
        Row: {
          config: Json
          created_at: string
          description: string
          educational_objective: string
          id: string
          level_number: number
          title: string
          unlock_requirements: Json
          updated_at: string
          world_number: number
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string
          educational_objective: string
          id: string
          level_number: number
          title: string
          unlock_requirements?: Json
          updated_at?: string
          world_number: number
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string
          educational_objective?: string
          id?: string
          level_number?: number
          title?: string
          unlock_requirements?: Json
          updated_at?: string
          world_number?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_character: string | null
          avatar_outfit: number
          created_at: string
          display_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_character?: string | null
          avatar_outfit?: number
          created_at?: string
          display_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_character?: string | null
          avatar_outfit?: number
          created_at?: string
          display_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      room_players: {
        Row: {
          joined_at: string
          left_at: string | null
          room_id: string
          slot: number
          user_id: string
        }
        Insert: {
          joined_at?: string
          left_at?: string | null
          room_id: string
          slot: number
          user_id: string
        }
        Update: {
          joined_at?: string
          left_at?: string | null
          room_id?: string
          slot?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_state: {
        Row: {
          level_id: string
          level_started_at: string | null
          room_id: string
          state: Json
          updated_at: string
          version: number
        }
        Insert: {
          level_id: string
          level_started_at?: string | null
          room_id: string
          state?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          level_id?: string
          level_started_at?: string | null
          room_id?: string
          state?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_state_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_state_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_level: {
        Args: { p_level_id: string; p_room_id: string }
        Returns: Json
      }
      create_room: { Args: never; Returns: Json }
      get_couple_levels: {
        Args: never
        Returns: {
          best_duration_seconds: number
          completed_at: string
          config: Json
          description: string
          educational_objective: string
          level_id: string
          level_number: number
          stars: number
          status: string
          title: string
          unlocked: boolean
          world_number: number
        }[]
      }
      get_room_snapshot: { Args: { p_room_id: string }; Returns: Json }
      join_room: { Args: { p_code: string }; Returns: Json }
      leave_room: { Args: { p_room_id: string }; Returns: Json }
      start_level: {
        Args: { p_level_id: string; p_restart?: boolean; p_room_id: string }
        Returns: Json
      }
      submit_puzzle_part: {
        Args: { p_puzzle: string; p_room_id: string; p_value?: Json }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
