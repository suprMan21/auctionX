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
      admin_roles: {
        Row: {
          created_at: string | null
          permissions: Database["public"]["Enums"]["admin_permission"][]
          role_id: string
          role_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          permissions: Database["public"]["Enums"]["admin_permission"][]
          role_id?: string
          role_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          permissions?: Database["public"]["Enums"]["admin_permission"][]
          role_id?: string
          role_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          admin_id: string
          assigned_by: string | null
          brand: string
          created_at: string | null
          is_active: boolean | null
          last_active_at: string | null
          role_id: string
          session_version: number
        }
        Insert: {
          admin_id: string
          assigned_by?: string | null
          brand: string
          created_at?: string | null
          is_active?: boolean | null
          last_active_at?: string | null
          role_id: string
          session_version?: number
        }
        Update: {
          admin_id?: string
          assigned_by?: string | null
          brand?: string
          created_at?: string | null
          is_active?: boolean | null
          last_active_at?: string | null
          role_id?: string
          session_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "admin_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["role_id"]
          },
        ]
      }
      auctions: {
        Row: {
          created_at: string
          currency: string
          current_price_cents: number
          end_time: string
          high_bidder_id: string | null
          high_bidder_max_cents: number | null
          id: string
          listing_id: string
          minimum_increment_cents: number
          reserve_price_cents: number | null
          second_highest_max_cents: number | null
          seller_id: string
          start_time: string
          starting_price_cents: number
          status: Database["public"]["Enums"]["auction_status"]
          updated_at: string
          winner_id: string | null
          winning_bid_id: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          current_price_cents: number
          end_time: string
          high_bidder_id?: string | null
          high_bidder_max_cents?: number | null
          id?: string
          listing_id: string
          minimum_increment_cents?: number
          reserve_price_cents?: number | null
          second_highest_max_cents?: number | null
          seller_id: string
          start_time: string
          starting_price_cents: number
          status?: Database["public"]["Enums"]["auction_status"]
          updated_at?: string
          winner_id?: string | null
          winning_bid_id?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          current_price_cents?: number
          end_time?: string
          high_bidder_id?: string | null
          high_bidder_max_cents?: number | null
          id?: string
          listing_id?: string
          minimum_increment_cents?: number
          reserve_price_cents?: number | null
          second_highest_max_cents?: number | null
          seller_id?: string
          start_time?: string
          starting_price_cents?: number
          status?: Database["public"]["Enums"]["auction_status"]
          updated_at?: string
          winner_id?: string | null
          winning_bid_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auctions_high_bidder_id_fkey"
            columns: ["high_bidder_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auctions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
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
      audit_logs: {
        Row: {
          action: string
          admin_email: string
          admin_id: string
          brand: string
          changes: Json | null
          created_at: string | null
          entity_id: string
          entity_type: string
          ip_address: unknown
          log_id: string
          reason: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_email: string
          admin_id: string
          brand: string
          changes?: Json | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          ip_address?: unknown
          log_id?: string
          reason?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_email?: string
          admin_id?: string
          brand?: string
          changes?: Json | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          ip_address?: unknown
          log_id?: string
          reason?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      bids: {
        Row: {
          amount_cents: number
          auction_id: string
          bidder_id: string
          created_at: string
          id: string
          is_auto_bid: boolean
          max_bid_cents: number | null
        }
        Insert: {
          amount_cents: number
          auction_id: string
          bidder_id: string
          created_at?: string
          id?: string
          is_auto_bid?: boolean
          max_bid_cents?: number | null
        }
        Update: {
          amount_cents?: number
          auction_id?: string
          bidder_id?: string
          created_at?: string
          id?: string
          is_auto_bid?: boolean
          max_bid_cents?: number | null
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
            foreignKeyName: "bids_bidder_id_fkey"
            columns: ["bidder_id"]
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
      crypto_payments: {
        Row: {
          actually_paid_crypto: number | null
          completed_at: string | null
          created_at: string
          crypto_address: string
          crypto_amount: number
          crypto_currency: string
          expires_at: string
          id: string
          metadata: Json | null
          network_fee_crypto: number | null
          nowpayments_payment_id: string
          payment_url: string
          transaction_id: string
          updated_at: string
        }
        Insert: {
          actually_paid_crypto?: number | null
          completed_at?: string | null
          created_at?: string
          crypto_address: string
          crypto_amount: number
          crypto_currency: string
          expires_at: string
          id?: string
          metadata?: Json | null
          network_fee_crypto?: number | null
          nowpayments_payment_id: string
          payment_url: string
          transaction_id: string
          updated_at?: string
        }
        Update: {
          actually_paid_crypto?: number | null
          completed_at?: string | null
          created_at?: string
          crypto_address?: string
          crypto_amount?: number
          crypto_currency?: string
          expires_at?: string
          id?: string
          metadata?: Json | null
          network_fee_crypto?: number | null
          nowpayments_payment_id?: string
          payment_url?: string
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crypto_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      item_verifications: {
        Row: {
          created_at: string
          current_owner_id: string | null
          id: string
          listing_id: string
          nfc_programmed_at: string | null
          nfc_tag_uid: string | null
          scan_count: number
          seller_id: string
          share_count: number
          status: Database["public"]["Enums"]["verification_status"]
          token_name: string
          updated_at: string
          video_duration_seconds: number | null
          video_url: string | null
          view_count: number
        }
        Insert: {
          created_at?: string
          current_owner_id?: string | null
          id?: string
          listing_id: string
          nfc_programmed_at?: string | null
          nfc_tag_uid?: string | null
          scan_count?: number
          seller_id: string
          share_count?: number
          status?: Database["public"]["Enums"]["verification_status"]
          token_name: string
          updated_at?: string
          video_duration_seconds?: number | null
          video_url?: string | null
          view_count?: number
        }
        Update: {
          created_at?: string
          current_owner_id?: string | null
          id?: string
          listing_id?: string
          nfc_programmed_at?: string | null
          nfc_tag_uid?: string | null
          scan_count?: number
          seller_id?: string
          share_count?: number
          status?: Database["public"]["Enums"]["verification_status"]
          token_name?: string
          updated_at?: string
          video_duration_seconds?: number | null
          video_url?: string | null
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_verifications_current_owner_id_fkey"
            columns: ["current_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_verifications_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_verifications_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      moderation_queue: {
        Row: {
          action_taken: Database["public"]["Enums"]["moderation_action"] | null
          assigned_at: string | null
          assigned_to: string | null
          brand: string
          created_at: string | null
          flagged_by: string | null
          flagged_by_system: boolean | null
          flagged_reason: string
          listing_id: string
          priority: number | null
          queue_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["moderation_status"]
          updated_at: string | null
        }
        Insert: {
          action_taken?: Database["public"]["Enums"]["moderation_action"] | null
          assigned_at?: string | null
          assigned_to?: string | null
          brand: string
          created_at?: string | null
          flagged_by?: string | null
          flagged_by_system?: boolean | null
          flagged_reason: string
          listing_id: string
          priority?: number | null
          queue_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          updated_at?: string | null
        }
        Update: {
          action_taken?: Database["public"]["Enums"]["moderation_action"] | null
          assigned_at?: string | null
          assigned_to?: string | null
          brand?: string
          created_at?: string | null
          flagged_by?: string | null
          flagged_by_system?: boolean | null
          flagged_reason?: string
          listing_id?: string
          priority?: number | null
          queue_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["moderation_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["admin_id"]
          },
          {
            foreignKeyName: "moderation_queue_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["admin_id"]
          },
        ]
      }
      ownership_transfers: {
        Row: {
          from_user_id: string | null
          id: string
          settlement_id: string | null
          to_user_id: string
          transfer_type: Database["public"]["Enums"]["transfer_type"]
          transferred_at: string
          verification_id: string
        }
        Insert: {
          from_user_id?: string | null
          id?: string
          settlement_id?: string | null
          to_user_id: string
          transfer_type: Database["public"]["Enums"]["transfer_type"]
          transferred_at?: string
          verification_id: string
        }
        Update: {
          from_user_id?: string | null
          id?: string
          settlement_id?: string | null
          to_user_id?: string
          transfer_type?: Database["public"]["Enums"]["transfer_type"]
          transferred_at?: string
          verification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ownership_transfers_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_transfers_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_transfers_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_transfers_verification_id_fkey"
            columns: ["verification_id"]
            isOneToOne: false
            referencedRelation: "item_verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          attempt_number: number
          correlation_id: string
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_payment_id: string | null
          raw_response: Json | null
          response_time_ms: number | null
          success: boolean
          transaction_id: string
        }
        Insert: {
          attempt_number: number
          correlation_id: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_payment_id?: string | null
          raw_response?: Json | null
          response_time_ms?: number | null
          success?: boolean
          transaction_id: string
        }
        Update: {
          attempt_number?: number
          correlation_id?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          processor?: Database["public"]["Enums"]["payment_processor"]
          processor_payment_id?: string | null
          raw_response?: Json | null
          response_time_ms?: number | null
          success?: boolean
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_penalties: {
        Row: {
          applied_at: string
          created_at: string
          expires_at: string | null
          id: string
          offer_id: string | null
          penalty_level: number
          reason: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          settlement_id: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          offer_id?: string | null
          penalty_level: number
          reason?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          settlement_id: string
          user_id: string
        }
        Update: {
          applied_at?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          offer_id?: string | null
          penalty_level?: number
          reason?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          settlement_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_penalties_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "settlement_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_penalties_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_penalties_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_penalties_user_id_fkey"
            columns: ["user_id"]
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
          processor_customer_id?: string | null
          processor_payment_id?: string | null
          seller_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
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
      payouts: {
        Row: {
          completed_at: string | null
          created_at: string
          currency: string
          eligible_at: string
          failed_at: string | null
          failure_reason: string | null
          gross_amount_cents: number
          id: string
          initiated_at: string | null
          net_payout_cents: number
          payout_method: string
          payout_processor_id: string | null
          platform_fee_cents: number
          processor_fee_cents: number
          seller_id: string
          settlement_id: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          currency?: string
          eligible_at: string
          failed_at?: string | null
          failure_reason?: string | null
          gross_amount_cents: number
          id?: string
          initiated_at?: string | null
          net_payout_cents: number
          payout_method?: string
          payout_processor_id?: string | null
          platform_fee_cents: number
          processor_fee_cents: number
          seller_id: string
          settlement_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          currency?: string
          eligible_at?: string
          failed_at?: string | null
          failure_reason?: string | null
          gross_amount_cents?: number
          id?: string
          initiated_at?: string | null
          net_payout_cents?: number
          payout_method?: string
          payout_processor_id?: string | null
          platform_fee_cents?: number
          processor_fee_cents?: number
          seller_id?: string
          settlement_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      processor_config: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          max_attempts: number
          metadata: Json | null
          priority: number
          processor: Database["public"]["Enums"]["payment_processor"]
          retry_delay_ms: number
          supported_flags: Database["public"]["Enums"]["content_flag"][]
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          max_attempts?: number
          metadata?: Json | null
          priority: number
          processor: Database["public"]["Enums"]["payment_processor"]
          retry_delay_ms?: number
          supported_flags?: Database["public"]["Enums"]["content_flag"][]
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          max_attempts?: number
          metadata?: Json | null
          priority?: number
          processor?: Database["public"]["Enums"]["payment_processor"]
          retry_delay_ms?: number
          supported_flags?: Database["public"]["Enums"]["content_flag"][]
          updated_at?: string
        }
        Relationships: []
      }
      processor_health: {
        Row: {
          checked_at: string
          created_at: string
          id: string
          last_error: string | null
          latency_ms: number | null
          processor: Database["public"]["Enums"]["payment_processor"]
          status: Database["public"]["Enums"]["processor_health_status"]
          success_rate_24h: number | null
          updated_at: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          latency_ms?: number | null
          processor: Database["public"]["Enums"]["payment_processor"]
          status?: Database["public"]["Enums"]["processor_health_status"]
          success_rate_24h?: number | null
          updated_at?: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          id?: string
          last_error?: string | null
          latency_ms?: number | null
          processor?: Database["public"]["Enums"]["payment_processor"]
          status?: Database["public"]["Enums"]["processor_health_status"]
          success_rate_24h?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          initiated_by: string | null
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_refund_id: string
          reason: string | null
          transaction_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          initiated_by?: string | null
          processor: Database["public"]["Enums"]["payment_processor"]
          processor_refund_id: string
          reason?: string | null
          transaction_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          initiated_by?: string | null
          processor?: Database["public"]["Enums"]["payment_processor"]
          processor_refund_id?: string
          reason?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_offers: {
        Row: {
          bidder_id: string
          created_at: string
          id: string
          offer_price_cents: number
          offer_rank: number
          payment_window_expires_at: string
          settlement_id: string
          status: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          bidder_id: string
          created_at?: string
          id?: string
          offer_price_cents: number
          offer_rank: number
          payment_window_expires_at: string
          settlement_id: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          bidder_id?: string
          created_at?: string
          id?: string
          offer_price_cents?: number
          offer_rank?: number
          payment_window_expires_at?: string
          settlement_id?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_offers_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_offers_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_offers_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          auction_id: string
          buyer_id: string | null
          created_at: string
          dispute_opened_at: string | null
          dispute_reason: string | null
          escrow_ends_at: string | null
          escrow_released_at: string | null
          gross_amount_cents: number
          id: string
          net_amount_cents: number
          offer_attempt: number
          payment_id: string | null
          payment_window_expires_at: string | null
          platform_fee_cents: number
          platform_fee_percent: number
          processor_fee_cents: number
          processor_fee_percent: number
          processor_transaction_id: string | null
          seller_id: string
          settled_at: string | null
          status: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          auction_id: string
          buyer_id?: string | null
          created_at?: string
          dispute_opened_at?: string | null
          dispute_reason?: string | null
          escrow_ends_at?: string | null
          escrow_released_at?: string | null
          gross_amount_cents: number
          id?: string
          net_amount_cents: number
          offer_attempt?: number
          payment_id?: string | null
          payment_window_expires_at?: string | null
          platform_fee_cents: number
          platform_fee_percent: number
          processor_fee_cents: number
          processor_fee_percent: number
          processor_transaction_id?: string | null
          seller_id: string
          settled_at?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          auction_id?: string
          buyer_id?: string | null
          created_at?: string
          dispute_opened_at?: string | null
          dispute_reason?: string | null
          escrow_ends_at?: string | null
          escrow_released_at?: string | null
          gross_amount_cents?: number
          id?: string
          net_amount_cents?: number
          offer_attempt?: number
          payment_id?: string | null
          payment_window_expires_at?: string | null
          platform_fee_cents?: number
          platform_fee_percent?: number
          processor_fee_cents?: number
          processor_fee_percent?: number
          processor_transaction_id?: string | null
          seller_id?: string
          settled_at?: string | null
          status?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          {
            foreignKeyName: "settlements_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
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
      transactions: {
        Row: {
          amount_cents: number
          auction_id: string
          buyer_id: string
          cascade_correlation_id: string
          content_flags: Database["public"]["Enums"]["content_flag"][]
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          payment_completed_at: string | null
          payment_window_expires_at: string
          payment_window_status: Database["public"]["Enums"]["payment_window_status"]
          platform_fee_cents: number
          risk_level: Database["public"]["Enums"]["content_risk_level"]
          seller_id: string
          seller_payout_cents: number
          status: Database["public"]["Enums"]["transaction_status"]
          successful_payment_id: string | null
          successful_processor:
            | Database["public"]["Enums"]["payment_processor"]
            | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          auction_id: string
          buyer_id: string
          cascade_correlation_id?: string
          content_flags?: Database["public"]["Enums"]["content_flag"][]
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          payment_completed_at?: string | null
          payment_window_expires_at: string
          payment_window_status?: Database["public"]["Enums"]["payment_window_status"]
          platform_fee_cents: number
          risk_level: Database["public"]["Enums"]["content_risk_level"]
          seller_id: string
          seller_payout_cents: number
          status?: Database["public"]["Enums"]["transaction_status"]
          successful_payment_id?: string | null
          successful_processor?:
            | Database["public"]["Enums"]["payment_processor"]
            | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          auction_id?: string
          buyer_id?: string
          cascade_correlation_id?: string
          content_flags?: Database["public"]["Enums"]["content_flag"][]
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          payment_completed_at?: string | null
          payment_window_expires_at?: string
          payment_window_status?: Database["public"]["Enums"]["payment_window_status"]
          platform_fee_cents?: number
          risk_level?: Database["public"]["Enums"]["content_risk_level"]
          seller_id?: string
          seller_payout_cents?: number
          status?: Database["public"]["Enums"]["transaction_status"]
          successful_payment_id?: string | null
          successful_processor?:
            | Database["public"]["Enums"]["payment_processor"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: true
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_seller_id_fkey"
            columns: ["seller_id"]
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
          banned_by: string | null
          banned_until: string | null
          bio: string | null
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
          profile_photo_url: string | null
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
          banned_by?: string | null
          banned_until?: string | null
          bio?: string | null
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
          profile_photo_url?: string | null
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
          banned_by?: string | null
          banned_until?: string | null
          bio?: string | null
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
          profile_photo_url?: string | null
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
        Relationships: [
          {
            foreignKeyName: "users_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["admin_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_payment_penalty: {
        Args: { p_offer_id: string; p_settlement_id: string; p_user_id: string }
        Returns: number
      }
      ban_user: {
        Args: { p_admin_id: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      calculate_platform_fee_percent: {
        Args: { tier: Database["public"]["Enums"]["tier_level"] }
        Returns: number
      }
      calculate_processor_success_rate: {
        Args: {
          p_hours?: number
          p_processor: Database["public"]["Enums"]["payment_processor"]
        }
        Returns: number
      }
      calculate_seller_tier: {
        Args: { trailing_12mo_sales: number }
        Returns: Database["public"]["Enums"]["tier_level"]
      }
      deactivate_admin: {
        Args: { p_admin_id: string; p_reason?: string }
        Returns: undefined
      }
      determine_risk_level: {
        Args: { flags: Database["public"]["Enums"]["content_flag"][] }
        Returns: Database["public"]["Enums"]["content_risk_level"]
      }
      generate_token_name: { Args: { p_user_id: string }; Returns: string }
      get_minimum_next_bid: { Args: { auction_uuid: string }; Returns: number }
      get_next_eligible_bidder: {
        Args: { p_auction_id: string; p_exclude_uids: string[] }
        Returns: {
          bidder_id: string
          max_bid_cents: number
        }[]
      }
      get_winning_bid: { Args: { auction_uuid: string }; Returns: string }
      is_high_bidder: {
        Args: { auction_uuid: string; user_uuid: string }
        Returns: boolean
      }
      reactivate_admin: { Args: { p_admin_id: string }; Returns: undefined }
      revoke_admin_session: { Args: { p_admin_id: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      suspend_user: {
        Args: {
          p_admin_id: string
          p_duration_hours: number
          p_reason: string
          p_user_id: string
        }
        Returns: undefined
      }
      unban_user: {
        Args: { p_admin_id: string; p_user_id: string }
        Returns: undefined
      }
      unsuspend_user: {
        Args: { p_admin_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      admin_permission:
        | "view_users"
        | "manage_users"
        | "view_listings"
        | "moderate_listings"
        | "view_payments"
        | "process_refunds"
        | "view_analytics"
        | "manage_admins"
        | "view_audit_logs"
      auction_status:
        | "DRAFT"
        | "SCHEDULED"
        | "ACTIVE"
        | "ENDED"
        | "CANCELLED"
        | "SETTLED"
      brand_type: "AUCTIONX" | "UNMENTIONABLES"
      content_flag:
        | "CONCERT_GEAR"
        | "MEMORABILIA"
        | "AUTOGRAPHED"
        | "SPORTS_EQUIPMENT"
        | "VINTAGE_COLLECTIBLES"
        | "FAN_MERCHANDISE"
        | "CREATOR_MERCH"
        | "COSPLAY"
        | "GAMING"
        | "COLLECTIBLES"
        | "DIGITAL_GOODS"
        | "ADULT_CONTENT"
        | "NSFW"
        | "18_PLUS"
        | "EXPLICIT"
        | "INTIMATE_ITEMS"
      content_risk_level: "LOW" | "MEDIUM" | "HIGH"
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
      moderation_action:
        | "approve"
        | "reject"
        | "remove_listing"
        | "suspend_user"
        | "ban_user"
        | "flag_for_review"
      moderation_status:
        | "pending"
        | "in_review"
        | "approved"
        | "rejected"
        | "escalated"
      payment_method_type: "CARD" | "CRYPTO"
      payment_processor:
        | "STRIPE"
        | "PAYMENTCLOUD"
        | "SIGNATURE"
        | "CCBILL"
        | "NOWPAYMENTS"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "refunded"
      payment_window_status: "ACTIVE" | "EXPIRED" | "COMPLETED" | "CANCELLED"
      processor_health_status: "HEALTHY" | "DEGRADED" | "DOWN"
      tier_level: "TIER_1" | "TIER_2" | "TIER_3"
      transaction_status:
        | "PENDING"
        | "PROCESSING"
        | "SUCCEEDED"
        | "FAILED"
        | "REFUNDED"
        | "PARTIALLY_REFUNDED"
        | "DISPUTED"
        | "EXPIRED"
      transfer_type: "SALE" | "GIFT" | "RETURN"
      user_role:
        | "user"
        | "moderator"
        | "admin"
        | "super_admin"
        | "support"
        | "finance"
      verification_status:
        | "NONE"
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "VIDEO_UPLOADED"
        | "NFC_PROGRAMMED"
        | "VERIFIED"
        | "FLAGGED"
        | "REVOKED"
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
      admin_permission: [
        "view_users",
        "manage_users",
        "view_listings",
        "moderate_listings",
        "view_payments",
        "process_refunds",
        "view_analytics",
        "manage_admins",
        "view_audit_logs",
      ],
      auction_status: [
        "DRAFT",
        "SCHEDULED",
        "ACTIVE",
        "ENDED",
        "CANCELLED",
        "SETTLED",
      ],
      brand_type: ["AUCTIONX", "UNMENTIONABLES"],
      content_flag: [
        "CONCERT_GEAR",
        "MEMORABILIA",
        "AUTOGRAPHED",
        "SPORTS_EQUIPMENT",
        "VINTAGE_COLLECTIBLES",
        "FAN_MERCHANDISE",
        "CREATOR_MERCH",
        "COSPLAY",
        "GAMING",
        "COLLECTIBLES",
        "DIGITAL_GOODS",
        "ADULT_CONTENT",
        "NSFW",
        "18_PLUS",
        "EXPLICIT",
        "INTIMATE_ITEMS",
      ],
      content_risk_level: ["LOW", "MEDIUM", "HIGH"],
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
      moderation_action: [
        "approve",
        "reject",
        "remove_listing",
        "suspend_user",
        "ban_user",
        "flag_for_review",
      ],
      moderation_status: [
        "pending",
        "in_review",
        "approved",
        "rejected",
        "escalated",
      ],
      payment_method_type: ["CARD", "CRYPTO"],
      payment_processor: [
        "STRIPE",
        "PAYMENTCLOUD",
        "SIGNATURE",
        "CCBILL",
        "NOWPAYMENTS",
      ],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
      ],
      payment_window_status: ["ACTIVE", "EXPIRED", "COMPLETED", "CANCELLED"],
      processor_health_status: ["HEALTHY", "DEGRADED", "DOWN"],
      tier_level: ["TIER_1", "TIER_2", "TIER_3"],
      transaction_status: [
        "PENDING",
        "PROCESSING",
        "SUCCEEDED",
        "FAILED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
        "DISPUTED",
        "EXPIRED",
      ],
      transfer_type: ["SALE", "GIFT", "RETURN"],
      user_role: [
        "user",
        "moderator",
        "admin",
        "super_admin",
        "support",
        "finance",
      ],
      verification_status: [
        "NONE",
        "PENDING",
        "APPROVED",
        "REJECTED",
        "VIDEO_UPLOADED",
        "NFC_PROGRAMMED",
        "VERIFIED",
        "FLAGGED",
        "REVOKED",
      ],
    },
  },
} as const
