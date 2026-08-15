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
      account_tombstones: {
        Row: {
          deleted_at: string
          financial_ref: string
          purge_financial_at: string
          user_id: string
        }
        Insert: {
          deleted_at?: string
          financial_ref?: string
          purge_financial_at: string
          user_id: string
        }
        Update: {
          deleted_at?: string
          financial_ref?: string
          purge_financial_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_attest_challenges: {
        Row: {
          challenge_hash: string
          consumed_at: string | null
          context: Json
          created_at: string
          device_id: string
          expires_at: string
          id: string
          key_id: string
          purpose: string
          user_id: string
        }
        Insert: {
          challenge_hash: string
          consumed_at?: string | null
          context?: Json
          created_at?: string
          device_id: string
          expires_at: string
          id?: string
          key_id: string
          purpose: string
          user_id: string
        }
        Update: {
          challenge_hash?: string
          consumed_at?: string | null
          context?: Json
          created_at?: string
          device_id?: string
          expires_at?: string
          id?: string
          key_id?: string
          purpose?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_attest_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_attest_keys: {
        Row: {
          active: boolean
          attested_at: string
          bundle_version: string | null
          created_at: string
          device_id: string
          environment: string
          extensions_present: boolean
          key_id: string
          last_asserted_at: string | null
          public_key_pem: string
          receipt_base64: string
          sign_count: number
          updated_at: string
          user_id: string
          validation_category: number | null
        }
        Insert: {
          active?: boolean
          attested_at?: string
          bundle_version?: string | null
          created_at?: string
          device_id: string
          environment: string
          extensions_present?: boolean
          key_id: string
          last_asserted_at?: string | null
          public_key_pem: string
          receipt_base64: string
          sign_count?: number
          updated_at?: string
          user_id: string
          validation_category?: number | null
        }
        Update: {
          active?: boolean
          attested_at?: string
          bundle_version?: string | null
          created_at?: string
          device_id?: string
          environment?: string
          extensions_present?: boolean
          key_id?: string
          last_asserted_at?: string | null
          public_key_pem?: string
          receipt_base64?: string
          sign_count?: number
          updated_at?: string
          user_id?: string
          validation_category?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_attest_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      apple_auth_tokens: {
        Row: {
          created_at: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apple_auth_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "active_receipts"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "active_receipts"
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
      export_file_purge_queue: {
        Row: {
          attempts: number
          created_at: string
          file_path: string
          job_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          file_path: string
          job_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          file_path?: string
          job_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          artifacts?: Json
          attempt_count?: number
          created_at?: string
          error?: string | null
          expires_at?: string | null
          file_path?: string | null
          filters?: Json
          format: Database["public"]["Enums"]["export_format"]
          id?: string
          include_images?: boolean
          locked_at?: string | null
          next_retry_at?: string
          receipt_count?: number | null
          status?: Database["public"]["Enums"]["export_job_status"]
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          artifacts?: Json
          attempt_count?: number
          created_at?: string
          error?: string | null
          expires_at?: string | null
          file_path?: string | null
          filters?: Json
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          include_images?: boolean
          locked_at?: string | null
          next_retry_at?: string
          receipt_count?: number | null
          status?: Database["public"]["Enums"]["export_job_status"]
          timezone?: string | null
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
            referencedRelation: "active_receipts"
            referencedColumns: ["id"]
          },
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
          environment: string | null
          gross_amount: number | null
          id: string
          occurred_at: string | null
          raw: Json
          rc_event_id: string
          store: string | null
          subject_ref: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          currency?: string | null
          environment?: string | null
          gross_amount?: number | null
          id?: string
          occurred_at?: string | null
          raw?: Json
          rc_event_id: string
          store?: string | null
          subject_ref?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          currency?: string | null
          environment?: string | null
          gross_amount?: number | null
          id?: string
          occurred_at?: string | null
          raw?: Json
          rc_event_id?: string
          store?: string | null
          subject_ref?: string | null
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
      products: {
        Row: {
          active: boolean
          created_at: string
          fair_use_threshold: number | null
          id: string
          monthly_scan_cap: number | null
          offering: string
          term: string
          tier: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          fair_use_threshold?: number | null
          id: string
          monthly_scan_cap?: number | null
          offering: string
          term: string
          tier: string
        }
        Update: {
          active?: boolean
          created_at?: string
          fair_use_threshold?: number | null
          id?: string
          monthly_scan_cap?: number | null
          offering?: string
          term?: string
          tier?: string
        }
        Relationships: []
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
            referencedRelation: "active_receipts"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "active_receipts"
            referencedColumns: ["id"]
          },
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
      receipt_image_purge_queue: {
        Row: {
          attempts: number
          created_at: string
          image_path: string
          receipt_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          image_path: string
          receipt_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          image_path?: string
          receipt_id?: string
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "active_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_mutations: {
        Row: {
          created_at: string
          mutation_type: string
          operation_id: string
          receipt_id: string
          result_revision: number
          user_id: string
        }
        Insert: {
          created_at?: string
          mutation_type: string
          operation_id: string
          receipt_id: string
          result_revision: number
          user_id: string
        }
        Update: {
          created_at?: string
          mutation_type?: string
          operation_id?: string
          receipt_id?: string
          result_revision?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_mutations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "active_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_mutations_receipt_id_fkey"
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
          revision: number
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
          revision?: number
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
          revision?: number
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
            referencedRelation: "active_receipts"
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
      referral_redeem_attempts: {
        Row: {
          attestation_verdict: string
          code_id: string | null
          created_at: string
          device_id: string
          fraud_flags: Json
          id: number
          ip_hash: string
          result: string
          user_id: string
        }
        Insert: {
          attestation_verdict: string
          code_id?: string | null
          created_at?: string
          device_id: string
          fraud_flags?: Json
          id?: never
          ip_hash: string
          result: string
          user_id: string
        }
        Update: {
          attestation_verdict?: string
          code_id?: string | null
          created_at?: string
          device_id?: string
          fraud_flags?: Json
          id?: never
          ip_hash?: string
          result?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_redeem_attempts_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_redeem_attempts_user_id_fkey"
            columns: ["user_id"]
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
          offering: string | null
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
          offering?: string | null
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
          offering?: string | null
          product_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          store?: Database["public"]["Enums"]["subscription_store"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
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
      user_devices: {
        Row: {
          created_at: string
          device_id: string
          is_active: boolean
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          is_active?: boolean
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          is_active?: boolean
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_receipts: {
        Row: {
          acked_at: string | null
          capture_id: string | null
          capture_mode: Database["public"]["Enums"]["capture_mode"] | null
          category_id: number | null
          confirmed_via: Database["public"]["Enums"]["confirmed_via"] | null
          created_at: string | null
          currency: string | null
          deleted_at: string | null
          duplicate_match_strength: string | null
          duplicate_of: string | null
          extraction_mode: string | null
          id: string | null
          image_byte_size: number | null
          image_path: string | null
          merchant: string | null
          notes: string | null
          provider: Database["public"]["Enums"]["provider"] | null
          search_text: unknown
          status: Database["public"]["Enums"]["receipt_status"] | null
          total: number | null
          txn_date: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          acked_at?: string | null
          capture_id?: string | null
          capture_mode?: Database["public"]["Enums"]["capture_mode"] | null
          category_id?: number | null
          confirmed_via?: Database["public"]["Enums"]["confirmed_via"] | null
          created_at?: string | null
          currency?: string | null
          deleted_at?: string | null
          duplicate_match_strength?: string | null
          duplicate_of?: string | null
          extraction_mode?: string | null
          id?: string | null
          image_byte_size?: number | null
          image_path?: string | null
          merchant?: string | null
          notes?: string | null
          provider?: Database["public"]["Enums"]["provider"] | null
          search_text?: unknown
          status?: Database["public"]["Enums"]["receipt_status"] | null
          total?: number | null
          txn_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          acked_at?: string | null
          capture_id?: string | null
          capture_mode?: Database["public"]["Enums"]["capture_mode"] | null
          category_id?: number | null
          confirmed_via?: Database["public"]["Enums"]["confirmed_via"] | null
          created_at?: string | null
          currency?: string | null
          deleted_at?: string | null
          duplicate_match_strength?: string | null
          duplicate_of?: string | null
          extraction_mode?: string | null
          id?: string | null
          image_byte_size?: number | null
          image_path?: string | null
          merchant?: string | null
          notes?: string | null
          provider?: Database["public"]["Enums"]["provider"] | null
          search_text?: unknown
          status?: Database["public"]["Enums"]["receipt_status"] | null
          total?: number | null
          txn_date?: string | null
          updated_at?: string | null
          user_id?: string | null
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
            referencedRelation: "active_receipts"
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
    }
    Functions: {
      advance_app_attest_counter: {
        Args: {
          p_device_id: string
          p_expected_count: number
          p_key_id: string
          p_next_count: number
          p_user_id: string
        }
        Returns: boolean
      }
      apply_rc_event: {
        Args: {
          p_currency: string
          p_environment?: string
          p_event_id: string
          p_gross: number
          p_occurred_at: string
          p_period_end: string
          p_period_start: string
          p_product_id: string
          p_raw: Json
          p_store: string
          p_type: string
          p_user_id: string
        }
        Returns: {
          out_applied: boolean
          out_reason: string
        }[]
      }
      assert_active_device: {
        Args: { p_device_id: string; p_user_id: string }
        Returns: boolean
      }
      can_scan: {
        Args: { p_capture_id: string; p_user_id: string }
        Returns: {
          out_allowed: boolean
          out_deprioritized: boolean
          out_paywall: string
          out_reason: string
          out_remaining: number
        }[]
      }
      claim_app_attest_challenge: {
        Args: {
          p_challenge_hash: string
          p_context: Json
          p_device_id: string
          p_key_id: string
          p_purpose: string
          p_user_id: string
        }
        Returns: boolean
      }
      claim_export_job: {
        Args: { p_job_id: string; p_lease_seconds?: number }
        Returns: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_export_jobs: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_extraction_jobs: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempt_count: number
          capture_id: string
          capture_mode: Database["public"]["Enums"]["capture_mode"]
          default_currency: string
          image_byte_size: number
          image_path: string
          job_id: string
          receipt_id: string
          user_id: string
        }[]
      }
      claim_user_device: {
        Args: { p_device_id: string; p_takeover?: boolean }
        Returns: {
          out_status: string
        }[]
      }
      close_provider_breaker_after_probe: { Args: never; Returns: undefined }
      complete_export_job: {
        Args: {
          p_artifacts: Json
          p_expires_at: string
          p_job_id: string
          p_receipt_count: number
        }
        Returns: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_onboarding: {
        Args: {
          selected_category_ids: number[]
          selected_country?: string
          selected_default_currency?: string
        }
        Returns: undefined
      }
      configure_b5_schedules: {
        Args: never
        Returns: {
          out_job_id: number
          out_job_name: string
          out_schedule: string
        }[]
      }
      confirm_receipt_with_items: {
        Args: {
          p_category_id: number
          p_currency: string
          p_items: Json
          p_merchant: string
          p_notes: string
          p_receipt_id: string
          p_total: number
          p_txn_date: string
          p_user_id: string
        }
        Returns: boolean
      }
      delete_account: {
        Args: { p_retention_years?: number; p_user_id: string }
        Returns: {
          out_exports_queued: number
          out_images_queued: number
          out_payment_events_anonymized: number
          out_purge_financial_at: string
          out_receipts_deleted: number
        }[]
      }
      enqueue_export_job: {
        Args: {
          p_filters: Json
          p_format: Database["public"]["Enums"]["export_format"]
          p_include_images: boolean
          p_max_in_flight?: number
          p_timezone?: string
          p_user_id: string
        }
        Returns: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_provider_delay_job: {
        Args: {
          p_acked_at: string
          p_capture_id: string
          p_capture_mode: Database["public"]["Enums"]["capture_mode"]
          p_extraction_mode: string
          p_failure_threshold?: number
          p_failure_window_seconds?: number
          p_image_byte_size: number
          p_image_path: string
          p_last_error: string
          p_provider_attempted: string
          p_user_id: string
        }
        Returns: {
          out_breaker_state: string
          out_receipt_id: string
        }[]
      }
      ensure_user_referral_code: {
        Args: { p_user_id: string }
        Returns: string
      }
      export_receipt_rows: {
        Args: {
          p_amount_currency?: string
          p_amount_max?: number
          p_amount_min?: number
          p_category_ids?: number[]
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_text?: string
          p_user_id: string
        }
        Returns: {
          category_name: string
          created_at: string
          currency: string
          id: string
          image_path: string
          line_items: Json
          merchant: string
          notes: string
          total: number
          txn_date: string
        }[]
      }
      fail_export_job: {
        Args: { p_backoff_seconds?: number; p_error: string; p_job_id: string }
        Returns: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_or_reschedule_extraction_job: {
        Args: {
          p_backoff_seconds?: number
          p_job_id: string
          p_last_error: string
          p_provider_attempted: string
        }
        Returns: {
          out_dead: boolean
        }[]
      }
      finish_extraction_job: {
        Args: { p_job_id: string; p_provider_attempted?: string }
        Returns: undefined
      }
      generate_referral_code: { Args: never; Returns: string }
      get_provider_state: {
        Args: never
        Returns: {
          out_consecutive_failures: number
          out_last_probe_at: string
          out_opened_at: string
          out_state: string
        }[]
      }
      get_referral_summary: {
        Args: never
        Returns: {
          out_code: string
          out_max_rewards: number
          out_referred: boolean
          out_rewarded: number
        }[]
      }
      health_check: { Args: never; Returns: number }
      prune_app_attest_challenges: { Args: never; Returns: number }
      purge_expired_exports: {
        Args: { p_before?: string; p_dry_run?: boolean; p_limit?: number }
        Returns: {
          out_file_path: string
          out_job_id: string
        }[]
      }
      purge_expired_financial_records: {
        Args: { p_dry_run?: boolean; p_limit?: number; p_now?: string }
        Returns: {
          out_commissions: number
          out_payment_events: number
          out_user_id: string
        }[]
      }
      purge_soft_deleted_receipts: {
        Args: { p_before?: string; p_dry_run?: boolean; p_limit?: number }
        Returns: {
          image_path: string
          receipt_id: string
        }[]
      }
      redeem_referral: {
        Args: {
          p_attestation_valid: boolean
          p_attestation_verdict: string
          p_code: string
          p_device_id: string
          p_entry_method: string
          p_fraud_flags?: Json
          p_ip_hash: string
          p_user_id: string
        }
        Returns: {
          out_granted: boolean
          out_reason: string
          out_referral_id: string
          out_status: Database["public"]["Enums"]["referral_status"]
        }[]
      }
      refresh_receipt_search_text: {
        Args: { target_receipt_id: string }
        Returns: undefined
      }
      refund_scan: {
        Args: { p_capture_id: string; p_user_id: string }
        Returns: undefined
      }
      restore_receipt: { Args: { p_receipt_id: string }; Returns: string }
      retry_export_job: {
        Args: { p_job_id: string }
        Returns: {
          artifacts: Json
          attempt_count: number
          created_at: string
          error: string | null
          expires_at: string | null
          file_path: string | null
          filters: Json
          format: Database["public"]["Enums"]["export_format"]
          id: string
          include_images: boolean
          locked_at: string | null
          next_retry_at: string
          receipt_count: number | null
          status: Database["public"]["Enums"]["export_job_status"]
          timezone: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "export_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_receipts: {
        Args: {
          p_amount_currency?: string
          p_amount_max?: number
          p_amount_min?: number
          p_category_ids?: number[]
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_text?: string
        }
        Returns: {
          capture_id: string
          category_id: number
          category_name: string
          created_at: string
          currency: string
          id: string
          image_path: string
          line_items: Json
          merchant: string
          notes: string
          search_rank: number
          status: Database["public"]["Enums"]["receipt_status"]
          total: number
          txn_date: string
          updated_at: string
        }[]
      }
      soft_delete_receipt: { Args: { p_receipt_id: string }; Returns: string }
      store_apple_refresh_token: {
        Args: { p_refresh_token: string; p_user_id: string }
        Returns: undefined
      }
      take_apple_refresh_token: { Args: { p_user_id: string }; Returns: string }
      update_receipt_with_items: {
        Args: {
          p_category_id: number
          p_currency: string
          p_items: Json
          p_merchant: string
          p_notes: string
          p_receipt_id: string
          p_total: number
          p_txn_date: string
        }
        Returns: string
      }
      update_receipt_with_items_v2: {
        Args: {
          p_category_id: number
          p_currency: string
          p_expected_revision: number
          p_items: Json
          p_merchant: string
          p_notes: string
          p_operation_id: string
          p_receipt_id: string
          p_total: number
          p_txn_date: string
        }
        Returns: number
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
      subscription_store: "apple" | "google" | "test"
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
      subscription_store: ["apple", "google", "test"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
