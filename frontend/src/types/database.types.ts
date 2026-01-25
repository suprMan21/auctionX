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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      auctions: {
        Row: {
          created_at: string
          current_bid_cents: number | null
          end_time: string
          id: string
          listing_id: string
          original_auction_id: string | null
          relist_count: number
          reserve_price_cents: number | null
          seller_id: string
          start_time: string
          starting_bid_cents: number
          status: Database["public"]["Enums"]["auction_status"]
          updated_at: string
          winner_id: string | null
          winning_bid_cents: number | null
        }
        Insert: {
          created_at?: string
          current_bid_cents?: number | null
          end_time: string
          id?: string
          listing_id: string
          original_auction_id?: string | null
          relist_count?: number
          reserve_price_cents?: number | null
          seller_id: string
          start_time: string
          starting_bid_cents: number
          status?: Database["public"]["Enums"]["auction_status"]
          updated_at?: string
          winner_id?: string | null
          winning_bid_cents?: number | null
        }
        Update: {
          created_at?: string
          current_bid_cents?: number | null
          end_time?: string
          id?: string
          listing_id?: string
          original_auction_id?: string | null
          relist_count?: number
          reserve_price_cents?: number | null
          seller_id?: string
          start_time?: string
          starting_bid_cents?: number
          status?: Database["public"]["Enums"]["auction_status"]
          updated_at?: string
          winner_id?: string | null
          winning_bid_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "auctions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_original_auction_id_fkey"
            columns: ["original_auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bids: {
        Row: {
          amount_cents: number
          auction_id: string
          created_at: string
          id: string
          is_autobid: boolean
          max_bid_cents: number
          user_id: string
        }
        Insert: {
          amount_cents: number
          auction_id: string
          created_at?: string
          id?: string
          is_autobid?: boolean
          max_bid_cents: number
          user_id: string
        }
        Update: {
          amount_cents?: number
          auction_id?: string
          created_at?: string
          id?: string
          is_autobid?: boolean
          max_bid_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          brand_restriction: Database["public"]["Enums"]["brand_type"] | null
          created_at: string
          description: string | null
          id: string
          is_nsfw: boolean
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          brand_restriction?: Database["public"]["Enums"]["brand_type"] | null
          created_at?: string
          description?: string | null
          id?: string
          is_nsfw?: boolean
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          brand_restriction?: Database["public"]["Enums"]["brand_type"] | null
          created_at?: string
          description?: string | null
          id?: string
          is_nsfw?: boolean
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_media: {
        Row: {
          duration_seconds: number | null
          height: number | null
          id: string
          listing_id: string
          s3_bucket: string
          s3_key: string
          size_bytes: number
          sort_order: number
          thumbnail_url: string | null
          type: string
          uploaded_at: string
          url: string
          width: number | null
        }
        Insert: {
          duration_seconds?: number | null
          height?: number | null
          id?: string
          listing_id: string
          s3_bucket: string
          s3_key: string
          size_bytes: number
          sort_order?: number
          thumbnail_url?: string | null
          type: string
          uploaded_at?: string
          url: string
          width?: number | null
        }
        Update: {
          duration_seconds?: number | null
          height?: number | null
          id?: string
          listing_id?: string
          s3_bucket?: string
          s3_key?: string
          size_bytes?: number
          sort_order?: number
          thumbnail_url?: string | null
          type?: string
          uploaded_at?: string
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_media_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          brand: Database["public"]["Enums"]["brand_type"]
          category_id: string
          condition: Database["public"]["Enums"]["item_condition"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          deleted_at: string | null
          description: string | null
          id: string
          is_featured: boolean
          is_nsfw: boolean
          location_city: string | null
          location_country: string | null
          location_region: string | null
          published_at: string | null
          requires_age_verification: boolean
          reserve_price_cents: number | null
          seller_id: string
          status: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at: string
        }
        Insert: {
          brand: Database["public"]["Enums"]["brand_type"]
          category_id: string
          condition: Database["public"]["Enums"]["item_condition"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_featured?: boolean
          is_nsfw?: boolean
          location_city?: string | null
          location_country?: string | null
          location_region?: string | null
          published_at?: string | null
          requires_age_verification?: boolean
          reserve_price_cents?: number | null
          seller_id: string
          status?: Database["public"]["Enums"]["listing_status"]
          title: string
          updated_at?: string
        }
        Update: {
          brand?: Database["public"]["Enums"]["brand_type"]
          category_id?: string
          condition?: Database["public"]["Enums"]["item_condition"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_featured?: boolean
          is_nsfw?: boolean
          location_city?: string | null
          location_country?: string | null
          location_region?: string | null
          published_at?: string | null
          requires_age_verification?: boolean
          reserve_price_cents?: number | null
          seller_id?: string
          status?: Database["public"]["Enums"]["listing_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          auction_id: string
          buyer_id: string
          completed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          payment_window_expires_at: string
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_customer_id: string | null
          processor_payment_id: string | null
          seller_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          auction_id: string
          buyer_id: string
          completed_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          payment_window_expires_at: string
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_customer_id?: string | null
          processor_payment_id?: string | null
          seller_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          auction_id?: string
          buyer_id?: string
          completed_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          payment_window_expires_at?: string
          processor?: Database["public"]["Enums"]["payment_processor"]
          processor_customer_id?: string | null
          processor_payment_id?: string | null
          seller_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          auction_id: string
          created_at: string
          gross_amount_cents: number
          id: string
          net_amount_cents: number
          payment_id: string
          platform_fee_cents: number
          platform_fee_percent: number
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_fee_cents: number
          processor_fee_percent: number
          processor_transaction_id: string | null
          seller_id: string
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          auction_id: string
          created_at?: string
          gross_amount_cents: number
          id?: string
          net_amount_cents: number
          payment_id: string
          platform_fee_cents: number
          platform_fee_percent: number
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_fee_cents: number
          processor_fee_percent: number
          processor_transaction_id?: string | null
          seller_id: string
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          auction_id?: string
          created_at?: string
          gross_amount_cents?: number
          id?: string
          net_amount_cents?: number
          payment_id?: string
          platform_fee_cents?: number
          platform_fee_percent?: number
          processor?: Database["public"]["Enums"]["payment_processor"]
          processor_fee_cents?: number
          processor_fee_percent?: number
          processor_transaction_id?: string | null
          seller_id?: string
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_addresses: {
        Row: {
          address_line1: string
          address_line2: string | null
          city: string
          country: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          phone_number: string | null
          postal_code: string
          region: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          city: string
          country: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          phone_number?: string | null
          postal_code: string
          region: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          phone_number?: string | null
          postal_code?: string
          region?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          age_verification_provider: string | null
          age_verified: boolean
          age_verified_at: string | null
          ban_reason: string | null
          banned_at: string | null
          banned_until: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          email: string
          id: string
          is_banned: boolean
          is_suspended: boolean
          last_login_at: string | null
          lifetime_sales_cents: number
          phone_number: string | null
          photo_url: string | null
          preferred_brand: Database["public"]["Enums"]["brand_type"] | null
          role: Database["public"]["Enums"]["user_role"]
          seller_tier: Database["public"]["Enums"]["tier_level"]
          seller_verification_rejection_reason: string | null
          seller_verification_reviewed_at: string | null
          seller_verification_status: Database["public"]["Enums"]["verification_status"]
          seller_verification_submitted_at: string | null
          suspended_at: string | null
          suspended_until: string | null
          suspension_reason: string | null
          tier_updated_at: string | null
          trailing_12mo_sales_cents: number
          updated_at: string
          warning_count: number
        }
        Insert: {
          age_verification_provider?: string | null
          age_verified?: boolean
          age_verified_at?: string | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_until?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email: string
          id?: string
          is_banned?: boolean
          is_suspended?: boolean
          last_login_at?: string | null
          lifetime_sales_cents?: number
          phone_number?: string | null
          photo_url?: string | null
          preferred_brand?: Database["public"]["Enums"]["brand_type"] | null
          role?: Database["public"]["Enums"]["user_role"]
          seller_tier?: Database["public"]["Enums"]["tier_level"]
          seller_verification_rejection_reason?: string | null
          seller_verification_reviewed_at?: string | null
          seller_verification_status?: Database["public"]["Enums"]["verification_status"]
          seller_verification_submitted_at?: string | null
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          tier_updated_at?: string | null
          trailing_12mo_sales_cents?: number
          updated_at?: string
          warning_count?: number
        }
        Update: {
          age_verification_provider?: string | null
          age_verified?: boolean
          age_verified_at?: string | null
          ban_reason?: string | null
          banned_at?: string | null
          banned_until?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          is_banned?: boolean
          is_suspended?: boolean
          last_login_at?: string | null
          lifetime_sales_cents?: number
          phone_number?: string | null
          photo_url?: string | null
          preferred_brand?: Database["public"]["Enums"]["brand_type"] | null
          role?: Database["public"]["Enums"]["user_role"]
          seller_tier?: Database["public"]["Enums"]["tier_level"]
          seller_verification_rejection_reason?: string | null
          seller_verification_reviewed_at?: string | null
          seller_verification_status?: Database["public"]["Enums"]["verification_status"]
          seller_verification_submitted_at?: string | null
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          tier_updated_at?: string | null
          trailing_12mo_sales_cents?: number
          updated_at?: string
          warning_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_platform_fee_percent: {
        Args: { tier: Database["public"]["Enums"]["tier_level"] }
        Returns: number
      }
      calculate_seller_tier: {
        Args: { trailing_12mo_sales: number }
        Returns: Database["public"]["Enums"]["tier_level"]
      }
      get_winning_bid: { Args: { auction_uuid: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      auction_status:
        | "draft"
        | "scheduled"
        | "active"
        | "ended"
        | "cancelled"
        | "settled"
      brand_type: "AUCTIONX" | "UNMENTIONABLES"
      currency_code: "CAD" | "USD"
      item_condition:
        | "NEW"
        | "LIKE_NEW"
        | "EXCELLENT"
        | "GOOD"
        | "FAIR"
        | "POOR"
      listing_status:
        | "DRAFT"
        | "PENDING_REVIEW"
        | "ACTIVE"
        | "SOLD"
        | "CANCELLED"
        | "REMOVED"
      payment_processor: "STRIPE" | "SEGPAY" | "PAYMENTCLOUD"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "refunded"
      tier_level: "TIER_1" | "TIER_2" | "TIER_3"
      user_role:
        | "user"
        | "moderator"
        | "admin"
        | "super_admin"
        | "support"
        | "finance"
      verification_status: "NONE" | "PENDING" | "APPROVED" | "REJECTED"
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
      auction_status: [
        "draft",
        "scheduled",
        "active",
        "ended",
        "cancelled",
        "settled",
      ],
      brand_type: ["AUCTIONX", "UNMENTIONABLES"],
      currency_code: ["CAD", "USD"],
      item_condition: ["NEW", "LIKE_NEW", "EXCELLENT", "GOOD", "FAIR", "POOR"],
      listing_status: [
        "DRAFT",
        "PENDING_REVIEW",
        "ACTIVE",
        "SOLD",
        "CANCELLED",
        "REMOVED",
      ],
      payment_processor: ["STRIPE", "SEGPAY", "PAYMENTCLOUD"],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
      ],
      tier_level: ["TIER_1", "TIER_2", "TIER_3"],
      user_role: [
        "user",
        "moderator",
        "admin",
        "super_admin",
        "support",
        "finance",
      ],
      verification_status: ["NONE", "PENDING", "APPROVED", "REJECTED"],
    },
  },
} as const
