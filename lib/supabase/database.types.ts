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
      brand_credit_balances: {
        Row: {
          brand_id: string
          consumed_credits: number
          granted_credits: number
          reserved_credits: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          consumed_credits?: number
          granted_credits?: number
          reserved_credits?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          consumed_credits?: number
          granted_credits?: number
          reserved_credits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_credit_balances_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_credit_balances_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "public_catalog_products"
            referencedColumns: ["brand_id"]
          },
        ]
      }
      brand_members: {
        Row: {
          brand_id: string
          role: Database["public"]["Enums"]["brand_role"]
          user_id: string
        }
        Insert: {
          brand_id: string
          role: Database["public"]["Enums"]["brand_role"]
          user_id: string
        }
        Update: {
          brand_id?: string
          role?: Database["public"]["Enums"]["brand_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "public_catalog_products"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          logo_path: string | null
          name: string
          plan: string | null
          slug: string
          updated_at: string
          widget_config: Json
        }
        Insert: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          plan?: string | null
          slug: string
          updated_at?: string
          widget_config?: Json
        }
        Update: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          plan?: string | null
          slug?: string
          updated_at?: string
          widget_config?: Json
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          brand_id: string
          created_at: string
          id: string
          idempotency_key: string
          metadata: Json
          session_id: string | null
          type: Database["public"]["Enums"]["credit_transaction_type"]
        }
        Insert: {
          amount: number
          brand_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          metadata?: Json
          session_id?: string | null
          type: Database["public"]["Enums"]["credit_transaction_type"]
        }
        Update: {
          amount?: number
          brand_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          metadata?: Json
          session_id?: string | null
          type?: Database["public"]["Enums"]["credit_transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "public_catalog_products"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "credit_transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "merchant_try_on_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "try_on_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          name: string
          product_image_path: string
          slug: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          product_image_path: string
          slug: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          name?: string
          product_image_path?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "public_catalog_products"
            referencedColumns: ["brand_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      try_on_sessions: {
        Row: {
          anonymous_token_hash: string
          brand_id: string
          client_request_id: string
          completed_at: string | null
          consent_to_store: boolean
          created_at: string
          credit_cost: number | null
          deleted_at: string | null
          error_code: string | null
          expires_at: string
          id: string
          person_storage_path: string | null
          product_id: string
          provider_job_id: string | null
          provider_request_id: string | null
          result_storage_path: string | null
          sanitized_error_message: string | null
          status: Database["public"]["Enums"]["try_on_session_status"]
          upload_validated_at: string | null
        }
        Insert: {
          anonymous_token_hash: string
          brand_id: string
          client_request_id: string
          completed_at?: string | null
          consent_to_store?: boolean
          created_at?: string
          credit_cost?: number | null
          deleted_at?: string | null
          error_code?: string | null
          expires_at: string
          id?: string
          person_storage_path?: string | null
          product_id: string
          provider_job_id?: string | null
          provider_request_id?: string | null
          result_storage_path?: string | null
          sanitized_error_message?: string | null
          status?: Database["public"]["Enums"]["try_on_session_status"]
          upload_validated_at?: string | null
        }
        Update: {
          anonymous_token_hash?: string
          brand_id?: string
          client_request_id?: string
          completed_at?: string | null
          consent_to_store?: boolean
          created_at?: string
          credit_cost?: number | null
          deleted_at?: string | null
          error_code?: string | null
          expires_at?: string
          id?: string
          person_storage_path?: string | null
          product_id?: string
          provider_job_id?: string | null
          provider_request_id?: string | null
          result_storage_path?: string | null
          sanitized_error_message?: string | null
          status?: Database["public"]["Enums"]["try_on_session_status"]
          upload_validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "try_on_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "try_on_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "public_catalog_products"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "try_on_sessions_brand_product_fkey"
            columns: ["brand_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["brand_id", "id"]
          },
        ]
      }
    }
    Views: {
      merchant_try_on_sessions: {
        Row: {
          brand_id: string | null
          client_request_id: string | null
          completed_at: string | null
          consent_to_store: boolean | null
          created_at: string | null
          credit_cost: number | null
          deleted_at: string | null
          error_code: string | null
          expires_at: string | null
          id: string | null
          product_id: string | null
          provider_job_id: string | null
          provider_request_id: string | null
          sanitized_error_message: string | null
          status: Database["public"]["Enums"]["try_on_session_status"] | null
          upload_validated_at: string | null
        }
        Insert: {
          brand_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          consent_to_store?: boolean | null
          created_at?: string | null
          credit_cost?: number | null
          deleted_at?: string | null
          error_code?: string | null
          expires_at?: string | null
          id?: string | null
          product_id?: string | null
          provider_job_id?: string | null
          provider_request_id?: string | null
          sanitized_error_message?: string | null
          status?: Database["public"]["Enums"]["try_on_session_status"] | null
          upload_validated_at?: string | null
        }
        Update: {
          brand_id?: string | null
          client_request_id?: string | null
          completed_at?: string | null
          consent_to_store?: boolean | null
          created_at?: string | null
          credit_cost?: number | null
          deleted_at?: string | null
          error_code?: string | null
          expires_at?: string | null
          id?: string | null
          product_id?: string | null
          provider_job_id?: string | null
          provider_request_id?: string | null
          sanitized_error_message?: string | null
          status?: Database["public"]["Enums"]["try_on_session_status"] | null
          upload_validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "try_on_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "try_on_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "public_catalog_products"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "try_on_sessions_brand_product_fkey"
            columns: ["brand_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["brand_id", "id"]
          },
        ]
      }
      public_catalog_products: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          brand_slug: string | null
          category: string | null
          logo_path: string | null
          product_id: string | null
          product_image_path: string | null
          product_name: string | null
          product_slug: string | null
          widget_config: Json | null
        }
        Relationships: []
      }
    }
    Functions: {
      consume_reserved_brand_credits: {
        Args: { p_session_id: string }
        Returns: {
          available_credits: number
          brand_id: string
          consumed_credits: number
          credit_cost: number
          granted_credits: number
          reserved_credits: number
          session_id: string
          status: Database["public"]["Enums"]["try_on_session_status"]
          was_created: boolean
        }[]
      }
      create_brand_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      get_public_product_by_slugs: {
        Args: { p_brand_slug: string; p_product_slug: string }
        Returns: {
          brand_id: string
          brand_name: string
          brand_slug: string
          category: string
          logo_path: string
          product_id: string
          product_image_path: string
          product_name: string
          product_slug: string
          widget_config: Json
        }[]
      }
      grant_brand_credits: {
        Args: {
          p_amount: number
          p_brand_id: string
          p_idempotency_key: string
          p_metadata?: Json
        }
        Returns: {
          available_credits: number
          brand_id: string
          consumed_credits: number
          granted_credits: number
          reserved_credits: number
          transaction_id: string
          was_created: boolean
        }[]
      }
      is_valid_customer_upload_path: {
        Args: { object_path: string }
        Returns: boolean
      }
      is_valid_product_image_path: {
        Args: { object_path: string }
        Returns: boolean
      }
      is_valid_try_on_result_path: {
        Args: { object_path: string }
        Returns: boolean
      }
      queue_try_on_session: {
        Args: { p_session_id: string }
        Returns: {
          available_credits: number
          brand_id: string
          consumed_credits: number
          credit_cost: number
          granted_credits: number
          reserved_credits: number
          session_id: string
          status: Database["public"]["Enums"]["try_on_session_status"]
          was_created: boolean
        }[]
      }
      release_reserved_brand_credits: {
        Args: { p_session_id: string }
        Returns: {
          available_credits: number
          brand_id: string
          consumed_credits: number
          credit_cost: number
          granted_credits: number
          reserved_credits: number
          session_id: string
          status: Database["public"]["Enums"]["try_on_session_status"]
          was_created: boolean
        }[]
      }
      storage_product_images_brand_id: {
        Args: { object_path: string }
        Returns: string
      }
      try_on_v1_credit_cost: { Args: never; Returns: number }
      user_has_brand_role: {
        Args: {
          p_brand_id: string
          p_roles: Database["public"]["Enums"]["brand_role"][]
        }
        Returns: boolean
      }
    }
    Enums: {
      brand_role: "owner" | "admin" | "editor" | "analyst"
      credit_transaction_type: "grant" | "reserve" | "consume" | "release"
      try_on_session_status:
        | "pending_upload"
        | "queued"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
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
    Enums: {
      brand_role: ["owner", "admin", "editor", "analyst"],
      credit_transaction_type: ["grant", "reserve", "consume", "release"],
      try_on_session_status: [
        "pending_upload",
        "queued",
        "processing",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
} as const

