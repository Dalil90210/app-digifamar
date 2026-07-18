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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      buyer_profiles: {
        Row: {
          address: string | null
          contactless: boolean
          created_at: string
          delivery_frequency: string | null
          delivery_window: string | null
          notes: string | null
          sms_updates: boolean
          updated_at: string
          user_id: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          contactless?: boolean
          created_at?: string
          delivery_frequency?: string | null
          delivery_window?: string | null
          notes?: string | null
          sms_updates?: boolean
          updated_at?: string
          user_id: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          contactless?: boolean
          created_at?: string
          delivery_frequency?: string | null
          delivery_window?: string | null
          notes?: string | null
          sms_updates?: boolean
          updated_at?: string
          user_id?: string
          zip?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          buyer_id: string
          created_at: string
          farmer_id: string
          id: string
          last_message_at: string
          product_id: string | null
        }
        Insert: {
          buyer_id: string
          created_at?: string
          farmer_id: string
          id?: string
          last_message_at?: string
          product_id?: string | null
        }
        Update: {
          buyer_id?: string
          created_at?: string
          farmer_id?: string
          id?: string
          last_message_at?: string
          product_id?: string | null
        }
        Relationships: []
      }
      farmer_profiles: {
        Row: {
          acres: number | null
          address: string | null
          certifications: string[]
          city: string | null
          created_at: string
          description: string | null
          farm_name: string
          lat: number | null
          lng: number | null
          products: string[]
          state: string | null
          updated_at: string
          user_id: string
          verification_status: string
          years_farming: number | null
          zip: string | null
        }
        Insert: {
          acres?: number | null
          address?: string | null
          certifications?: string[]
          city?: string | null
          created_at?: string
          description?: string | null
          farm_name: string
          lat?: number | null
          lng?: number | null
          products?: string[]
          state?: string | null
          updated_at?: string
          user_id: string
          verification_status?: string
          years_farming?: number | null
          zip?: string | null
        }
        Update: {
          acres?: number | null
          address?: string | null
          certifications?: string[]
          city?: string | null
          created_at?: string
          description?: string | null
          farm_name?: string
          lat?: number | null
          lng?: number | null
          products?: string[]
          state?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: string
          years_farming?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      listings: {
        Row: {
          category: string
          created_at: string
          description: string | null
          farmer_id: string
          id: string
          images: string[]
          lat: number | null
          lng: number | null
          price_cents: number
          qty_available: number
          slug: string
          status: string
          title: string
          unit: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          farmer_id: string
          id?: string
          images?: string[]
          lat?: number | null
          lng?: number | null
          price_cents: number
          qty_available?: number
          slug: string
          status?: string
          title: string
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          farmer_id?: string
          id?: string
          images?: string[]
          lat?: number | null
          lng?: number | null
          price_cents?: number
          qty_available?: number
          slug?: string
          status?: string
          title?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          created_at: string
          id: string
          order_id: string
          metadata: Json
          event_type: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          metadata?: Json
          event_type?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          metadata?: Json
          event_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_id: string
          created_at: string
          delivery_deadline: string | null
          escrow_fee_cents: number
          farmer_id: string
          id: string
          listing_id: string
          notes: string | null
          platform_fee_cents: number
          qty: number
          shipping_address: string | null
          status: string
          subtotal_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          buyer_id: string
          created_at?: string
          delivery_deadline?: string | null
          escrow_fee_cents?: number
          farmer_id: string
          id?: string
          listing_id: string
          notes?: string | null
          platform_fee_cents?: number
          qty: number
          shipping_address?: string | null
          status?: string
          subtotal_cents: number
          total_cents: number
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          created_at?: string
          delivery_deadline?: string | null
          escrow_fee_cents?: number
          farmer_id?: string
          id?: string
          listing_id?: string
          notes?: string | null
          platform_fee_cents?: number
          qty?: number
          shipping_address?: string | null
          status?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          body: string | null
          buyer_id: string
          created_at: string
          farmer_id: string
          id: string
          order_id: string
          rating: number
        }
        Insert: {
          body?: string | null
          buyer_id: string
          created_at?: string
          farmer_id: string
          id?: string
          order_id: string
          rating: number
        }
        Update: {
          body?: string | null
          buyer_id?: string
          created_at?: string
          farmer_id?: string
          id?: string
          order_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "farmer" | "buyer"
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
      app_role: ["admin", "farmer", "buyer"],
    },
  },
} as const
