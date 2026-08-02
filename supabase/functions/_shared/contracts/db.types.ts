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
      account_tombstones: {
        Row: {
          deleted_at: string
          purge_financial_at: string
          user_id: string
        }
        Insert: {
          deleted_at?: string
          purge_financial_at: string
          user_id: string
        }
        Update: {
          deleted_at?: string
          purge_financial_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: number
          is_default: boolean
          is_system: boolean
          name: string
        }
        Insert: {
          id?: number
          is_default?: boolean
          is_system?: boolean
          name: string
        }
        Update: {
          id?: number
          is_default?: boolean
          is_system?: boolean
          name?: string
        }
        Relationships: []
      }
      commission_ledger: {
        Row: {
          code_id: string
          commission_amount: number
          id: string
          paid_at: string | null
          payment_event_id: string
          status: string
        }
        Insert: {
          code_id: string
          commission_amount: number
          id?: string
          paid_at?: string | null
          payment_event_id: string
          status: string
        }
        Update: {
          code_id?: string
          commission_amount?: number
          id?: string
          paid_at?: string | null
          payment_event_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_ledger_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_ledger_payment_event_id_fkey"
            columns: ["payment_event_id"]
            isOneToOne: true
            referencedRelation: "payment_events"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_shadow_events: {
        Row: {
          action: string
          capture_id: string
          created_at: string
          currency: string | null
          id: string
          match_rule: string
          match_strength: string
          matched_merchant: string | null
          matched_merchant_key: string | null
          matched_receipt_id: string | null
          matched_total: number | null
          merchant: string | null
          merchant_key: string | null
          receipt_id: string | null
          total: number | null
          total_minor_units: number | null
          txn_date: string | null
          user_id: string
        }
        Insert: {
          action?: string
          capture_id: string
          created_at?: string
          currency?: string | null
          id?: string
          match_rule: string
          match_strength: string
          matched_merchant?: string | null
          matched_merchant_key?: string | null
          matched_receipt_id?: string | null
          matched_total?: number | null
          merchant?: string | null
          merchant_key?: string | null
          receipt_id?: string | null
          total?: number | null
          total_minor_units?: number | null
          txn_date?: string | null
          user_id: string
        }
        Update: {
          action?: string
          capture_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          match_rule?: string
          match_strength?: string
          matched_merchant?: string | null
          matched_merchant_key?: string | null
          matched_receipt_id?: string | null
          matched_total?: number | null
          merchant?: string | null
          merchant_key?: string | null
          receipt_id?: string | null
          total?: number | null
          total_minor_units?: number | null
          txn_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_shadow_events_matched_receipt_id_fkey"
            columns: ["matched_receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_shadow_events_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_shadow_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          created_at: string
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          status: Database["public"]["Enums"]["export_job_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          file_path?: string | null
          filters?: Json
          format: Database["public"]["Enums"]["export_format"]
          id?: string
          include_images?: boolean
          status?: Database["public"]["Enums"]["export_job_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          file_path?: string | null
          filters?: Json
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          include_images?: boolean
          status?: Database["public"]["Enums"]["export_job_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          next_retry_at: string
          provider_attempted: string | null
          receipt_id: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          next_retry_at?: string
          provider_attempted?: string | null
          receipt_id: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          next_retry_at?: string
          provider_attempted?: string | null
          receipt_id?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_jobs_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_persist_jobs: {
        Row: {
          attempts: number
          capture_id: string
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          payload: Json
          receipt_id: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          capture_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          payload: Json
          receipt_id?: string | null
          started_at?: string | null
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          capture_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          receipt_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_persist_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          currency: string | null
          gross_amount: number | null
          id: string
          occurred_at: string | null
          raw: Json
          rc_event_id: string
          store: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          currency?: string | null
          gross_amount?: number | null
          id?: string
          occurred_at?: string | null
          raw?: Json
          rc_event_id: string
          store?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          currency?: string | null
          gross_amount?: number | null
          id?: string
          occurred_at?: string | null
          raw?: Json
          rc_event_id?: string
          store?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          country: string | null
          created_at: string
          default_currency: string
          display_name: string | null
          id: string
          onboarding_complete: boolean
          referred_by_code: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id: string
          onboarding_complete?: boolean
          referred_by_code?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          onboarding_complete?: boolean
          referred_by_code?: string | null
        }
        Relationships: []
      }
      provider_state: {
        Row: {
          consecutive_failures: number
          id: number
          last_probe_at: string | null
          opened_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          id?: number
          last_probe_at?: string | null
          opened_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          id?: number
          last_probe_at?: string | null
          opened_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          platform: Database["public"]["Enums"]["push_platform"]
          token: string
          user_id: string
        }
        Insert: {
          platform: Database["public"]["Enums"]["push_platform"]
          token: string
          user_id: string
        }
        Update: {
          platform?: Database["public"]["Enums"]["push_platform"]
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_capture_attempts: {
        Row: {
          app_state: string | null
          attempt_number: number
          attempt_timeout_ms: number | null
          capture_id: string
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          error_message: string | null
          id: string
          ms_since_warmup: number | null
          network_gap_ms: number | null
          receipt_id: string | null
          retry_delay_ms: number | null
          server_auth_ms: number | null
          server_body_ms: number | null
          server_model_ms: number | null
          server_normalize_ms: number | null
          server_total_ms: number | null
          started_at: string | null
          status_code: number | null
          timed_out: number | null
          transport: string
          transport_error: number | null
          user_id: string
        }
        Insert: {
          app_state?: string | null
          attempt_number: number
          attempt_timeout_ms?: number | null
          capture_id: string
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          ms_since_warmup?: number | null
          network_gap_ms?: number | null
          receipt_id?: string | null
          retry_delay_ms?: number | null
          server_auth_ms?: number | null
          server_body_ms?: number | null
          server_model_ms?: number | null
          server_normalize_ms?: number | null
          server_total_ms?: number | null
          started_at?: string | null
          status_code?: number | null
          timed_out?: number | null
          transport?: string
          transport_error?: number | null
          user_id: string
        }
        Update: {
          app_state?: string | null
          attempt_number?: number
          attempt_timeout_ms?: number | null
          capture_id?: string
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          ms_since_warmup?: number | null
          network_gap_ms?: number | null
          receipt_id?: string | null
          retry_delay_ms?: number | null
          server_auth_ms?: number | null
          server_body_ms?: number | null
          server_model_ms?: number | null
          server_normalize_ms?: number | null
          server_total_ms?: number | null
          started_at?: string | null
          status_code?: number | null
          timed_out?: number | null
          transport?: string
          transport_error?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_capture_attempts_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_capture_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_capture_metrics: {
        Row: {
          backend_extract_ms: number | null
          capture_id: string
          capture_mode: string
          compression_ms: number | null
          created_at: string
          document_correction_ms: number | null
          extraction_mode: string
          id: string
          image_backup_ms: number | null
          local_file_ms: number | null
          local_ocr_ms: number | null
          local_ocr_timed_out: number | null
          local_row_ms: number | null
          metrics_upload_ms: number | null
          ocr_image_resize_ms: number | null
          ocr_input_height: number | null
          ocr_input_width: number | null
          ocr_timeout_ms: number | null
          receipt_id: string | null
          total_to_response_ms: number | null
          total_to_ui_ms: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          backend_extract_ms?: number | null
          capture_id: string
          capture_mode: string
          compression_ms?: number | null
          created_at?: string
          document_correction_ms?: number | null
          extraction_mode: string
          id?: string
          image_backup_ms?: number | null
          local_file_ms?: number | null
          local_ocr_ms?: number | null
          local_ocr_timed_out?: number | null
          local_row_ms?: number | null
          metrics_upload_ms?: number | null
          ocr_image_resize_ms?: number | null
          ocr_input_height?: number | null
          ocr_input_width?: number | null
          ocr_timeout_ms?: number | null
          receipt_id?: string | null
          total_to_response_ms?: number | null
          total_to_ui_ms?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          backend_extract_ms?: number | null
          capture_id?: string
          capture_mode?: string
          compression_ms?: number | null
          created_at?: string
          document_correction_ms?: number | null
          extraction_mode?: string
          id?: string
          image_backup_ms?: number | null
          local_file_ms?: number | null
          local_ocr_ms?: number | null
          local_ocr_timed_out?: number | null
          local_row_ms?: number | null
          metrics_upload_ms?: number | null
          ocr_image_resize_ms?: number | null
          ocr_input_height?: number | null
          ocr_input_width?: number | null
          ocr_timeout_ms?: number | null
          receipt_id?: string | null
          total_to_response_ms?: number | null
          total_to_ui_ms?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_capture_metrics_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_capture_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_items: {
        Row: {
          amount: number
          id: string
          name: string
          qty: number
          receipt_id: string
        }
        Insert: {
          amount?: number
          id?: string
          name: string
          qty?: number
          receipt_id: string
        }
        Update: {
          amount?: number
          id?: string
          name?: string
          qty?: number
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          acked_at: string | null
          capture_id: string
          capture_mode: Database["public"]["Enums"]["capture_mode"]
          category_id: number | null
          confirmed_via: Database["public"]["Enums"]["confirmed_via"] | null
          created_at: string
          currency: string
          deleted_at: string | null
          duplicate_match_strength: string | null
          duplicate_of: string | null
          extraction_mode: string
          id: string
          image_byte_size: number | null
          image_path: string | null
          merchant: string | null
          notes: string | null
          provider: Database["public"]["Enums"]["provider"] | null
          search_text: unknown
          status: Database["public"]["Enums"]["receipt_status"]
          total: number | null
          txn_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acked_at?: string | null
          capture_id: string
          capture_mode: Database["public"]["Enums"]["capture_mode"]
          category_id?: number | null
          confirmed_via?: Database["public"]["Enums"]["confirmed_via"] | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          duplicate_match_strength?: string | null
          duplicate_of?: string | null
          extraction_mode?: string
          id?: string
          image_byte_size?: number | null
          image_path?: string | null
          merchant?: string | null
          notes?: string | null
          provider?: Database["public"]["Enums"]["provider"] | null
          search_text?: unknown
          status?: Database["public"]["Enums"]["receipt_status"]
          total?: number | null
          txn_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acked_at?: string | null
          capture_id?: string
          capture_mode?: Database["public"]["Enums"]["capture_mode"]
          category_id?: number | null
          confirmed_via?: Database["public"]["Enums"]["confirmed_via"] | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          duplicate_match_strength?: string | null
          duplicate_of?: string | null
          extraction_mode?: string
          id?: string
          image_byte_size?: number | null
          image_path?: string | null
          merchant?: string | null
          notes?: string | null
          provider?: Database["public"]["Enums"]["provider"] | null
          search_text?: unknown
          status?: Database["public"]["Enums"]["receipt_status"]
          total?: number | null
          txn_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          active: boolean
          code: string
          commission_rate: number | null
          id: string
          kind: Database["public"]["Enums"]["referral_code_kind"]
          max_uses: number | null
          owner_user_id: string | null
          payout_contact: string | null
        }
        Insert: {
          active?: boolean
          code: string
          commission_rate?: number | null
          id?: string
          kind: Database["public"]["Enums"]["referral_code_kind"]
          max_uses?: number | null
          owner_user_id?: string | null
          payout_contact?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          commission_rate?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["referral_code_kind"]
          max_uses?: number | null
          owner_user_id?: string | null
          payout_contact?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code_id: string
          entry_method: string
          fraud_flags: Json
          id: string
          referred_user_id: string
          released_at: string | null
          status: Database["public"]["Enums"]["referral_status"]
        }
        Insert: {
          code_id: string
          entry_method: string
          fraud_flags?: Json
          id?: string
          referred_user_id: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Update: {
          code_id?: string
          entry_method?: string
          fraud_flags?: Json
          id?: string
          referred_user_id?: string
          released_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_attempts: {
        Row: {
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_ledger: {
        Row: {
          created_at: string
          delta: number
          id: string
          reason: Database["public"]["Enums"]["ledger_reason"]
          ref_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          reason: Database["public"]["Enums"]["ledger_reason"]
          ref_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          reason?: Database["public"]["Enums"]["ledger_reason"]
          ref_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scan_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          current_period_end: string | null
          current_period_start: string
          id: string
          product_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          store: Database["public"]["Enums"]["subscription_store"]
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end?: string | null
          current_period_start: string
          id?: string
          product_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          store: Database["public"]["Enums"]["subscription_store"]
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          product_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          store?: Database["public"]["Enums"]["subscription_store"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_categories: {
        Row: {
          category_id: number
          sort_order: number
          user_id: string
        }
        Insert: {
          category_id: number
          sort_order?: number
          user_id: string
        }
        Update: {
          category_id?: number
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_categories_user_id_fkey"
            columns: ["user_id"]
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
      can_scan: {
        Args: { p_capture_id: string; p_user_id: string }
        Returns: {
          out_allowed: boolean
          out_paywall: string
          out_reason: string
          out_remaining: number
        }[]
      }
      complete_onboarding: {
        Args: {
          selected_category_ids: number[]
          selected_country?: string
          selected_default_currency?: string
        }
        Returns: undefined
      }
      health_check: { Args: never; Returns: number }
      refresh_receipt_search_text: {
        Args: { target_receipt_id: string }
        Returns: undefined
      }
      refund_scan: {
        Args: { p_capture_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      capture_mode: "default" | "one_click"
      confirmed_via: "user" | "auto"
      export_format: "xlsx" | "pdf"
      export_job_status: "queued" | "running" | "done" | "failed"
      job_status: "queued" | "running" | "done" | "dead"
      ledger_reason:
        | "signup"
        | "referral_bonus"
        | "referred_signup"
        | "scan_used"
        | "refund"
        | "admin"
      provider: "grok" | "gemini"
      push_platform: "ios" | "android"
      receipt_status:
        | "processing"
        | "needs_review"
        | "confirmed"
        | "rejected"
        | "failed"
      referral_code_kind: "user" | "influencer"
      referral_status: "pending" | "released" | "blocked"
      subscription_status: "active" | "grace" | "expired"
      subscription_store: "apple" | "google"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
      capture_mode: ["default", "one_click"],
      confirmed_via: ["user", "auto"],
      export_format: ["xlsx", "pdf"],
      export_job_status: ["queued", "running", "done", "failed"],
      job_status: ["queued", "running", "done", "dead"],
      ledger_reason: [
        "signup",
        "referral_bonus",
        "referred_signup",
        "scan_used",
        "refund",
        "admin",
      ],
      provider: ["grok", "gemini"],
      push_platform: ["ios", "android"],
      receipt_status: [
        "processing",
        "needs_review",
        "confirmed",
        "rejected",
        "failed",
      ],
      referral_code_kind: ["user", "influencer"],
      referral_status: ["pending", "released", "blocked"],
      subscription_status: ["active", "grace", "expired"],
      subscription_store: ["apple", "google"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

