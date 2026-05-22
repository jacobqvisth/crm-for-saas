export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type PipelineStage = {
  name: string;
  order: number;
  probability: number;
  color: string;
};

export type WorkspaceSendingSettings = {
  default_max_daily_sends?: number; // default: 50
  bounce_threshold?: number; // default: 8 (percent)
};

export type SequenceSettings = {
  send_days: number[];
  send_start_hour: number;
  send_end_hour: number;
  timezone: string;
  /** Hard cap on emails this sequence can send per day from any single sender. Enforced in cron. */
  daily_limit_per_sender: number;
  /**
   * Optional hard cap on emails this sequence can send per day TOTAL across every sender combined.
   * When undefined or 0, no total cap is applied. Enforced in cron alongside daily_limit_per_sender.
   */
  daily_limit_total?: number;
  stop_on_reply: boolean;
  stop_on_company_reply: boolean;
  sender_rotation: boolean;
  /**
   * Optional per-sequence auto-rotate pool. When undefined or empty, auto-rotate
   * uses every active workspace Gmail account (today's behavior). When a non-empty
   * array of gmail_accounts.id values is set, auto-rotate restricts to those accounts.
   */
  rotation_account_ids?: string[];
};

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      _ops_queue_pause_2026_04_28: {
        Row: {
          captured_at: string | null
          contact_id: string | null
          country_code: string | null
          email: string | null
          queue_id: string
          scheduled_for: string | null
        }
        Insert: {
          captured_at?: string | null
          contact_id?: string | null
          country_code?: string | null
          email?: string | null
          queue_id: string
          scheduled_for?: string | null
        }
        Update: {
          captured_at?: string | null
          contact_id?: string | null
          country_code?: string | null
          email?: string | null
          queue_id?: string
          scheduled_for?: string | null
        }
        Relationships: []
      }
      activities: {
        Row: {
          body: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string | null
          deal_id: string | null
          id: string
          metadata: Json | null
          outcome: string | null
          subject: string | null
          type: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          subject?: string | null
          type: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          body?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          outcome?: string | null
          subject?: string | null
          type?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_owner_id: string | null
          acquisition_source: string | null
          activated_at: string | null
          address: string | null
          annual_revenue: number | null
          arr_cents: number | null
          category: string | null
          cfar_number: string | null
          churn_reason: string | null
          churned_at: string | null
          city: string | null
          country: string | null
          country_code: string | null
          county: string | null
          created_at: string | null
          created_by_agent: string | null
          currency: string | null
          custom_fields: Json | null
          customer_status: string | null
          description: string | null
          do_not_contact: boolean
          do_not_route: boolean
          do_not_route_at: string | null
          do_not_route_reason: string | null
          domain: string | null
          employee_count: number | null
          employee_size_band: string | null
          facebook_url: string | null
          founded_year: number | null
          geocoded_at: string | null
          google_place_id: string | null
          health_score: number | null
          id: string
          industry: string | null
          instagram_url: string | null
          is_sole_proprietor: boolean
          last_active_at: string | null
          last_visited_at: string | null
          latitude: number | null
          lifecycle_stage: string | null
          linkedin_url: string | null
          longitude: number | null
          marketing_opt_out: boolean
          member_count: number | null
          min_revisit_interval_days: number | null
          mrr_cents: number | null
          name: string
          nix_blocked: boolean
          notes: string | null
          org_number: string | null
          parent_company_id: string | null
          payment_status: string | null
          phone: string | null
          plan: string | null
          plan_billing_cycle: string | null
          postal_code: string | null
          rating: number | null
          revenue_range: string | null
          review_count: number | null
          skip_auto_followup: boolean
          source: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          tags: string[] | null
          tech_stack: string[] | null
          trial_ends_at: string | null
          updated_at: string | null
          website: string | null
          wl_workshop_id: string | null
          workspace_id: string
        }
        Insert: {
          account_owner_id?: string | null
          acquisition_source?: string | null
          activated_at?: string | null
          address?: string | null
          annual_revenue?: number | null
          arr_cents?: number | null
          category?: string | null
          cfar_number?: string | null
          churn_reason?: string | null
          churned_at?: string | null
          city?: string | null
          country?: string | null
          country_code?: string | null
          county?: string | null
          created_at?: string | null
          created_by_agent?: string | null
          currency?: string | null
          custom_fields?: Json | null
          customer_status?: string | null
          description?: string | null
          do_not_contact?: boolean
          do_not_route?: boolean
          do_not_route_at?: string | null
          do_not_route_reason?: string | null
          domain?: string | null
          employee_count?: number | null
          employee_size_band?: string | null
          facebook_url?: string | null
          founded_year?: number | null
          geocoded_at?: string | null
          google_place_id?: string | null
          health_score?: number | null
          id?: string
          industry?: string | null
          instagram_url?: string | null
          is_sole_proprietor?: boolean
          last_active_at?: string | null
          last_visited_at?: string | null
          latitude?: number | null
          lifecycle_stage?: string | null
          linkedin_url?: string | null
          longitude?: number | null
          marketing_opt_out?: boolean
          member_count?: number | null
          min_revisit_interval_days?: number | null
          mrr_cents?: number | null
          name: string
          nix_blocked?: boolean
          notes?: string | null
          org_number?: string | null
          parent_company_id?: string | null
          payment_status?: string | null
          phone?: string | null
          plan?: string | null
          plan_billing_cycle?: string | null
          postal_code?: string | null
          rating?: number | null
          revenue_range?: string | null
          review_count?: number | null
          skip_auto_followup?: boolean
          source?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          tags?: string[] | null
          tech_stack?: string[] | null
          trial_ends_at?: string | null
          updated_at?: string | null
          website?: string | null
          wl_workshop_id?: string | null
          workspace_id: string
        }
        Update: {
          account_owner_id?: string | null
          acquisition_source?: string | null
          activated_at?: string | null
          address?: string | null
          annual_revenue?: number | null
          arr_cents?: number | null
          category?: string | null
          cfar_number?: string | null
          churn_reason?: string | null
          churned_at?: string | null
          city?: string | null
          country?: string | null
          country_code?: string | null
          county?: string | null
          created_at?: string | null
          created_by_agent?: string | null
          currency?: string | null
          custom_fields?: Json | null
          customer_status?: string | null
          description?: string | null
          do_not_contact?: boolean
          do_not_route?: boolean
          do_not_route_at?: string | null
          do_not_route_reason?: string | null
          domain?: string | null
          employee_count?: number | null
          employee_size_band?: string | null
          facebook_url?: string | null
          founded_year?: number | null
          geocoded_at?: string | null
          google_place_id?: string | null
          health_score?: number | null
          id?: string
          industry?: string | null
          instagram_url?: string | null
          is_sole_proprietor?: boolean
          last_active_at?: string | null
          last_visited_at?: string | null
          latitude?: number | null
          lifecycle_stage?: string | null
          linkedin_url?: string | null
          longitude?: number | null
          marketing_opt_out?: boolean
          member_count?: number | null
          min_revisit_interval_days?: number | null
          mrr_cents?: number | null
          name?: string
          nix_blocked?: boolean
          notes?: string | null
          org_number?: string | null
          parent_company_id?: string | null
          payment_status?: string | null
          phone?: string | null
          plan?: string | null
          plan_billing_cycle?: string | null
          postal_code?: string | null
          rating?: number | null
          revenue_range?: string | null
          review_count?: number | null
          skip_auto_followup?: boolean
          source?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          tags?: string[] | null
          tech_stack?: string[] | null
          trial_ends_at?: string | null
          updated_at?: string | null
          website?: string | null
          wl_workshop_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      company_merge_candidates: {
        Row: {
          candidate_company_id: string
          created_at: string
          id: string
          match_signals: Json
          primary_company_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          similarity_score: number
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          candidate_company_id: string
          created_at?: string
          id?: string
          match_signals?: Json
          primary_company_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_score: number
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          candidate_company_id?: string
          created_at?: string
          id?: string
          match_signals?: Json
          primary_company_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_score?: number
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_merge_candidates_candidate_company_id_fkey"
            columns: ["candidate_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_merge_candidates_primary_company_id_fkey"
            columns: ["primary_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_merge_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_list_members: {
        Row: {
          added_at: string | null
          contact_id: string
          list_id: string
        }
        Insert: {
          added_at?: string | null
          contact_id: string
          list_id: string
        }
        Update: {
          added_at?: string | null
          contact_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_list_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_lists: {
        Row: {
          created_at: string | null
          description: string | null
          filters: Json | null
          id: string
          is_dynamic: boolean | null
          name: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          filters?: Json | null
          id?: string
          is_dynamic?: boolean | null
          name: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          filters?: Json | null
          id?: string
          is_dynamic?: boolean | null
          name?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_lists_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address: string | null
          all_emails: string[] | null
          all_phones: string[] | null
          app_role: string | null
          app_username: string | null
          attributed_at: string | null
          attributed_to_send_id: string | null
          attributed_to_sequence_id: string | null
          attributed_via: string | null
          city: string | null
          company_id: string | null
          country: string | null
          country_code: string | null
          created_at: string | null
          credits_remaining: number | null
          custom_fields: Json | null
          diagnostics_first_at: string | null
          diagnostics_last_30d: number | null
          diagnostics_last_at: string | null
          diagnostics_total: number | null
          email: string
          email_status: string
          email_verified_at: string | null
          facebook_url: string | null
          first_name: string | null
          id: string
          instagram_url: string | null
          is_primary: boolean | null
          language: string | null
          last_active_at: string | null
          last_contacted_at: string | null
          last_emailed_at: string | null
          last_login_at: string | null
          last_name: string | null
          last_visited_at: string | null
          lead_status: string | null
          linkedin_url: string | null
          login_count: number | null
          notes: string | null
          phone: string | null
          postal_code: string | null
          seniority: string | null
          source: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
          user_plan_type: string | null
          user_stripe_customer_id: string | null
          user_stripe_subscription_id: string | null
          user_subscription_status: string | null
          wl_user_id: string | null
          workspace_id: string
        }
        Insert: {
          address?: string | null
          all_emails?: string[] | null
          all_phones?: string[] | null
          app_role?: string | null
          app_username?: string | null
          attributed_at?: string | null
          attributed_to_send_id?: string | null
          attributed_to_sequence_id?: string | null
          attributed_via?: string | null
          city?: string | null
          company_id?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string | null
          credits_remaining?: number | null
          custom_fields?: Json | null
          diagnostics_first_at?: string | null
          diagnostics_last_30d?: number | null
          diagnostics_last_at?: string | null
          diagnostics_total?: number | null
          email: string
          email_status?: string
          email_verified_at?: string | null
          facebook_url?: string | null
          first_name?: string | null
          id?: string
          instagram_url?: string | null
          is_primary?: boolean | null
          language?: string | null
          last_active_at?: string | null
          last_contacted_at?: string | null
          last_emailed_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          last_visited_at?: string | null
          lead_status?: string | null
          linkedin_url?: string | null
          login_count?: number | null
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          seniority?: string | null
          source?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
          user_plan_type?: string | null
          user_stripe_customer_id?: string | null
          user_stripe_subscription_id?: string | null
          user_subscription_status?: string | null
          wl_user_id?: string | null
          workspace_id: string
        }
        Update: {
          address?: string | null
          all_emails?: string[] | null
          all_phones?: string[] | null
          app_role?: string | null
          app_username?: string | null
          attributed_at?: string | null
          attributed_to_send_id?: string | null
          attributed_to_sequence_id?: string | null
          attributed_via?: string | null
          city?: string | null
          company_id?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string | null
          credits_remaining?: number | null
          custom_fields?: Json | null
          diagnostics_first_at?: string | null
          diagnostics_last_30d?: number | null
          diagnostics_last_at?: string | null
          diagnostics_total?: number | null
          email?: string
          email_status?: string
          email_verified_at?: string | null
          facebook_url?: string | null
          first_name?: string | null
          id?: string
          instagram_url?: string | null
          is_primary?: boolean | null
          language?: string | null
          last_active_at?: string | null
          last_contacted_at?: string | null
          last_emailed_at?: string | null
          last_login_at?: string | null
          last_name?: string | null
          last_visited_at?: string | null
          lead_status?: string | null
          linkedin_url?: string | null
          login_count?: number | null
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          seniority?: string | null
          source?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
          user_plan_type?: string | null
          user_stripe_customer_id?: string | null
          user_stripe_subscription_id?: string | null
          user_subscription_status?: string | null
          wl_user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_attributed_to_send_id_fkey"
            columns: ["attributed_to_send_id"]
            isOneToOne: false
            referencedRelation: "email_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_attributed_to_sequence_id_fkey"
            columns: ["attributed_to_sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_routes: {
        Row: {
          assigned_to: string | null
          cluster_label: string
          created_at: string
          estimated_day_seconds: number
          generated_at: string
          generated_by: string | null
          generation_batch_id: string
          google_maps_deeplink: string
          id: string
          mode: string
          mode_fallback_reason: string | null
          origin_address: string
          origin_latitude: number
          origin_longitude: number
          routes_api_response: Json | null
          scheduled_for: string | null
          status: string
          stop_count: number
          total_drive_meters: number
          total_drive_seconds: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          cluster_label: string
          created_at?: string
          estimated_day_seconds: number
          generated_at?: string
          generated_by?: string | null
          generation_batch_id: string
          google_maps_deeplink: string
          id?: string
          mode: string
          mode_fallback_reason?: string | null
          origin_address: string
          origin_latitude: number
          origin_longitude: number
          routes_api_response?: Json | null
          scheduled_for?: string | null
          status?: string
          stop_count: number
          total_drive_meters: number
          total_drive_seconds: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          cluster_label?: string
          created_at?: string
          estimated_day_seconds?: number
          generated_at?: string
          generated_by?: string | null
          generation_batch_id?: string
          google_maps_deeplink?: string
          id?: string
          mode?: string
          mode_fallback_reason?: string | null
          origin_address?: string
          origin_latitude?: number
          origin_longitude?: number
          routes_api_response?: Json | null
          scheduled_for?: string | null
          status?: string
          stop_count?: number
          total_drive_meters?: number
          total_drive_seconds?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_routes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_cost_entries: {
        Row: {
          amount: number
          cost_entry_id: string
          item_key: string
          metadata: Json
          section: string
          snapshot_at: string
          unit: string
        }
        Insert: {
          amount?: number
          cost_entry_id: string
          item_key: string
          metadata?: Json
          section: string
          snapshot_at: string
          unit?: string
        }
        Update: {
          amount?: number
          cost_entry_id?: string
          item_key?: string
          metadata?: Json
          section?: string
          snapshot_at?: string
          unit?: string
        }
        Relationships: []
      }
      dashboard_cta_clicks: {
        Row: {
          button_text: string
          cta_location: string
          date: string
          events: number
          host_name: string
          id: number
          page_path: string
          synced_at: string
          users: number
        }
        Insert: {
          button_text?: string
          cta_location?: string
          date: string
          events?: number
          host_name: string
          id?: number
          page_path: string
          synced_at?: string
          users?: number
        }
        Update: {
          button_text?: string
          cta_location?: string
          date?: string
          events?: number
          host_name?: string
          id?: number
          page_path?: string
          synced_at?: string
          users?: number
        }
        Relationships: []
      }
      dashboard_diagnostic_chats: {
        Row: {
          chat_cost: number
          chat_id: string
          created_at: string | null
          diagnostic_id: string | null
          internal_user_id: string | null
          message_count: number
          metadata: Json
          total_input_tokens: number
          total_output_tokens: number
          total_thinking_tokens: number
          updated_at: string | null
          workshop_id: string | null
        }
        Insert: {
          chat_cost?: number
          chat_id: string
          created_at?: string | null
          diagnostic_id?: string | null
          internal_user_id?: string | null
          message_count?: number
          metadata?: Json
          total_input_tokens?: number
          total_output_tokens?: number
          total_thinking_tokens?: number
          updated_at?: string | null
          workshop_id?: string | null
        }
        Update: {
          chat_cost?: number
          chat_id?: string
          created_at?: string | null
          diagnostic_id?: string | null
          internal_user_id?: string | null
          message_count?: number
          metadata?: Json
          total_input_tokens?: number
          total_output_tokens?: number
          total_thinking_tokens?: number
          updated_at?: string | null
          workshop_id?: string | null
        }
        Relationships: []
      }
      dashboard_diagnostics: {
        Row: {
          ai_model: string | null
          analyzed_at: string | null
          completed_at: string | null
          created_at: string | null
          diag_cost: number
          diagnostic_id: string
          has_chat: boolean
          has_invoice: boolean
          input_tokens: number
          internal_user_id: string | null
          metadata: Json
          num_causes: number
          output_tokens: number
          parent_diagnostic_id: string | null
          status: string | null
          updated_at: string
          workshop_id: string | null
        }
        Insert: {
          ai_model?: string | null
          analyzed_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          diag_cost?: number
          diagnostic_id: string
          has_chat?: boolean
          has_invoice?: boolean
          input_tokens?: number
          internal_user_id?: string | null
          metadata?: Json
          num_causes?: number
          output_tokens?: number
          parent_diagnostic_id?: string | null
          status?: string | null
          updated_at?: string
          workshop_id?: string | null
        }
        Update: {
          ai_model?: string | null
          analyzed_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          diag_cost?: number
          diagnostic_id?: string
          has_chat?: boolean
          has_invoice?: boolean
          input_tokens?: number
          internal_user_id?: string | null
          metadata?: Json
          num_causes?: number
          output_tokens?: number
          parent_diagnostic_id?: string | null
          status?: string | null
          updated_at?: string
          workshop_id?: string | null
        }
        Relationships: []
      }
      dashboard_domain_health_checks: {
        Row: {
          alerts: Json
          blocklists: Json
          checked_at: string
          dns_records: Json
          domain: string
          id: string
          run_notes: string | null
          send_metrics: Json
          status: string
        }
        Insert: {
          alerts?: Json
          blocklists?: Json
          checked_at?: string
          dns_records?: Json
          domain: string
          id?: string
          run_notes?: string | null
          send_metrics?: Json
          status: string
        }
        Update: {
          alerts?: Json
          blocklists?: Json
          checked_at?: string
          dns_records?: Json
          domain?: string
          id?: string
          run_notes?: string | null
          send_metrics?: Json
          status?: string
        }
        Relationships: []
      }
      dashboard_funnel_snapshots: {
        Row: {
          collected_at: string
          count: number
          dimension_key: string
          dimensions: Json
          id: string
          period_end: string
          period_start: string
          source_key: string
          step_key: string
        }
        Insert: {
          collected_at?: string
          count: number
          dimension_key?: string
          dimensions?: Json
          id?: string
          period_end: string
          period_start: string
          source_key: string
          step_key: string
        }
        Update: {
          collected_at?: string
          count?: number
          dimension_key?: string
          dimensions?: Json
          id?: string
          period_end?: string
          period_start?: string
          source_key?: string
          step_key?: string
        }
        Relationships: []
      }
      dashboard_internal_test_patterns: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          value: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          value: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          value?: string
        }
        Relationships: []
      }
      dashboard_metric_snapshots: {
        Row: {
          collected_at: string
          currency: string | null
          dimension_key: string
          dimensions: Json
          id: string
          metric_key: string
          period_end: string
          period_start: string
          source_key: string
          unit: string
          value: number
        }
        Insert: {
          collected_at?: string
          currency?: string | null
          dimension_key?: string
          dimensions?: Json
          id?: string
          metric_key: string
          period_end: string
          period_start: string
          source_key: string
          unit?: string
          value: number
        }
        Update: {
          collected_at?: string
          currency?: string | null
          dimension_key?: string
          dimensions?: Json
          id?: string
          metric_key?: string
          period_end?: string
          period_start?: string
          source_key?: string
          unit?: string
          value?: number
        }
        Relationships: []
      }
      dashboard_motor_usage: {
        Row: {
          database_name: string | null
          metadata: Json
          month: string | null
          motor_usage_id: string
          total_accesses: number
          unique_users: number
          unique_vehicles: number
          updated_at: string
        }
        Insert: {
          database_name?: string | null
          metadata?: Json
          month?: string | null
          motor_usage_id: string
          total_accesses?: number
          unique_users?: number
          unique_vehicles?: number
          updated_at?: string
        }
        Update: {
          database_name?: string | null
          metadata?: Json
          month?: string | null
          motor_usage_id?: string
          total_accesses?: number
          unique_users?: number
          unique_vehicles?: number
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_raw_metric_rows: {
        Row: {
          collected_at: string
          external_id: string
          id: string
          payload: Json
          period_end: string
          period_start: string
          source_key: string
        }
        Insert: {
          collected_at?: string
          external_id: string
          id?: string
          payload: Json
          period_end: string
          period_start: string
          source_key: string
        }
        Update: {
          collected_at?: string
          external_id?: string
          id?: string
          payload?: Json
          period_end?: string
          period_start?: string
          source_key?: string
        }
        Relationships: []
      }
      dashboard_source_accounts: {
        Row: {
          account_id: string | null
          created_at: string
          display_name: string
          last_success_at: string | null
          metadata: Json
          source_key: string
          status: string
          updated_at: string
          watermark: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          display_name: string
          last_success_at?: string | null
          metadata?: Json
          source_key: string
          status?: string
          updated_at?: string
          watermark?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          display_name?: string
          last_success_at?: string | null
          metadata?: Json
          source_key?: string
          status?: string
          updated_at?: string
          watermark?: string | null
        }
        Relationships: []
      }
      dashboard_subscriptions: {
        Row: {
          cancel_at: string | null
          canceled_at: string | null
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          metadata: Json
          mrr_amount_cents: number
          plan_key: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string
          workshop_id: string | null
        }
        Insert: {
          cancel_at?: string | null
          canceled_at?: string | null
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          metadata?: Json
          mrr_amount_cents?: number
          plan_key?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string
          workshop_id?: string | null
        }
        Update: {
          cancel_at?: string | null
          canceled_at?: string | null
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          metadata?: Json
          mrr_amount_cents?: number
          plan_key?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_subscriptions_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "dashboard_workshops"
            referencedColumns: ["workshop_id"]
          },
        ]
      }
      dashboard_sync_runs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          metadata: Json
          rows_read: number
          rows_written: number
          source_key: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          rows_read?: number
          rows_written?: number
          source_key: string
          started_at?: string
          status: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          rows_read?: number
          rows_written?: number
          source_key?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      dashboard_users: {
        Row: {
          core_stripe_customer_id: string | null
          created_at: string | null
          customer_io_id: string | null
          email_hash: string | null
          ga_client_id: string | null
          internal_test_note: string | null
          internal_test_set_at: string | null
          internal_test_set_by: string | null
          internal_user_id: string
          is_internal_test: boolean
          is_internal_test_exempt: boolean
          last_seen_at: string | null
          metadata: Json
          name: string | null
          phone: string | null
          signed_up_at: string | null
          workshop_id: string | null
        }
        Insert: {
          core_stripe_customer_id?: string | null
          created_at?: string | null
          customer_io_id?: string | null
          email_hash?: string | null
          ga_client_id?: string | null
          internal_test_note?: string | null
          internal_test_set_at?: string | null
          internal_test_set_by?: string | null
          internal_user_id: string
          is_internal_test?: boolean
          is_internal_test_exempt?: boolean
          last_seen_at?: string | null
          metadata?: Json
          name?: string | null
          phone?: string | null
          signed_up_at?: string | null
          workshop_id?: string | null
        }
        Update: {
          core_stripe_customer_id?: string | null
          created_at?: string | null
          customer_io_id?: string | null
          email_hash?: string | null
          ga_client_id?: string | null
          internal_test_note?: string | null
          internal_test_set_at?: string | null
          internal_test_set_by?: string | null
          internal_user_id?: string
          is_internal_test?: boolean
          is_internal_test_exempt?: boolean
          last_seen_at?: string | null
          metadata?: Json
          name?: string | null
          phone?: string | null
          signed_up_at?: string | null
          workshop_id?: string | null
        }
        Relationships: []
      }
      dashboard_workshops: {
        Row: {
          activated_at: string | null
          core_stripe_customer_id: string | null
          core_stripe_subscription_id: string | null
          core_subscription_status: string | null
          country: string | null
          created_at: string | null
          created_by_agent: boolean | null
          internal_test_note: string | null
          internal_test_set_at: string | null
          internal_test_set_by: string | null
          is_internal_test: boolean
          language: string | null
          metadata: Json
          name: string | null
          owner_internal_user_id: string | null
          payment_status: string | null
          plan_key: string | null
          trial_end: string | null
          workshop_id: string
        }
        Insert: {
          activated_at?: string | null
          core_stripe_customer_id?: string | null
          core_stripe_subscription_id?: string | null
          core_subscription_status?: string | null
          country?: string | null
          created_at?: string | null
          created_by_agent?: boolean | null
          internal_test_note?: string | null
          internal_test_set_at?: string | null
          internal_test_set_by?: string | null
          is_internal_test?: boolean
          language?: string | null
          metadata?: Json
          name?: string | null
          owner_internal_user_id?: string | null
          payment_status?: string | null
          plan_key?: string | null
          trial_end?: string | null
          workshop_id: string
        }
        Update: {
          activated_at?: string | null
          core_stripe_customer_id?: string | null
          core_stripe_subscription_id?: string | null
          core_subscription_status?: string | null
          country?: string | null
          created_at?: string | null
          created_by_agent?: boolean | null
          internal_test_note?: string | null
          internal_test_set_at?: string | null
          internal_test_set_by?: string | null
          is_internal_test?: boolean
          language?: string | null
          metadata?: Json
          name?: string | null
          owner_internal_user_id?: string | null
          payment_status?: string | null
          plan_key?: string | null
          trial_end?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_workshops_owner_internal_user_id_fkey"
            columns: ["owner_internal_user_id"]
            isOneToOne: false
            referencedRelation: "dashboard_users"
            referencedColumns: ["internal_user_id"]
          },
        ]
      }
      deal_contacts: {
        Row: {
          contact_id: string
          deal_id: string
          role: string | null
        }
        Insert: {
          contact_id: string
          deal_id: string
          role?: string | null
        }
        Update: {
          contact_id?: string
          deal_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_contacts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          amount: number | null
          company_id: string | null
          created_at: string | null
          custom_fields: Json | null
          expected_close_date: string | null
          id: string
          name: string
          owner_id: string | null
          pipeline_id: string
          probability: number | null
          stage: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          company_id?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          expected_close_date?: string | null
          id?: string
          name: string
          owner_id?: string | null
          pipeline_id: string
          probability?: number | null
          stage: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number | null
          company_id?: string | null
          created_at?: string | null
          custom_fields?: Json | null
          expected_close_date?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          pipeline_id?: string
          probability?: number | null
          stage?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_shops: {
        Row: {
          additional_info: Json | null
          address: string | null
          all_categories: string[] | null
          all_emails: string[] | null
          all_phones: string[] | null
          category: string | null
          city: string | null
          country: string | null
          country_code: string | null
          created_at: string | null
          crm_company_id: string | null
          crm_contact_id: string | null
          description: string | null
          do_not_route: boolean
          do_not_route_at: string | null
          do_not_route_reason: string | null
          domain: string | null
          email_check_detail: string | null
          email_status: string | null
          email_valid: boolean | null
          email_verified_at: string | null
          facebook_url: string | null
          google_maps_url: string | null
          google_place_id: string | null
          id: string
          instagram_url: string | null
          latitude: number | null
          linkedin_url: string | null
          longitude: number | null
          name: string
          opening_hours: Json | null
          permanently_closed: boolean | null
          phone: string | null
          plus_code: string | null
          popular_times: Json | null
          postal_code: string | null
          price_level: number | null
          primary_email: string | null
          rating: number | null
          raw_data: Json | null
          review_count: number | null
          scraped_at: string | null
          shop_type: string | null
          source: string | null
          state: string | null
          status: string | null
          street: string | null
          temporarily_closed: boolean | null
          twitter_url: string | null
          updated_at: string | null
          website: string | null
          youtube_url: string | null
        }
        Insert: {
          additional_info?: Json | null
          address?: string | null
          all_categories?: string[] | null
          all_emails?: string[] | null
          all_phones?: string[] | null
          category?: string | null
          city?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string | null
          crm_company_id?: string | null
          crm_contact_id?: string | null
          description?: string | null
          do_not_route?: boolean
          do_not_route_at?: string | null
          do_not_route_reason?: string | null
          domain?: string | null
          email_check_detail?: string | null
          email_status?: string | null
          email_valid?: boolean | null
          email_verified_at?: string | null
          facebook_url?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          id?: string
          instagram_url?: string | null
          latitude?: number | null
          linkedin_url?: string | null
          longitude?: number | null
          name: string
          opening_hours?: Json | null
          permanently_closed?: boolean | null
          phone?: string | null
          plus_code?: string | null
          popular_times?: Json | null
          postal_code?: string | null
          price_level?: number | null
          primary_email?: string | null
          rating?: number | null
          raw_data?: Json | null
          review_count?: number | null
          scraped_at?: string | null
          shop_type?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          street?: string | null
          temporarily_closed?: boolean | null
          twitter_url?: string | null
          updated_at?: string | null
          website?: string | null
          youtube_url?: string | null
        }
        Update: {
          additional_info?: Json | null
          address?: string | null
          all_categories?: string[] | null
          all_emails?: string[] | null
          all_phones?: string[] | null
          category?: string | null
          city?: string | null
          country?: string | null
          country_code?: string | null
          created_at?: string | null
          crm_company_id?: string | null
          crm_contact_id?: string | null
          description?: string | null
          do_not_route?: boolean
          do_not_route_at?: string | null
          do_not_route_reason?: string | null
          domain?: string | null
          email_check_detail?: string | null
          email_status?: string | null
          email_valid?: boolean | null
          email_verified_at?: string | null
          facebook_url?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          id?: string
          instagram_url?: string | null
          latitude?: number | null
          linkedin_url?: string | null
          longitude?: number | null
          name?: string
          opening_hours?: Json | null
          permanently_closed?: boolean | null
          phone?: string | null
          plus_code?: string | null
          popular_times?: Json | null
          postal_code?: string | null
          price_level?: number | null
          primary_email?: string | null
          rating?: number | null
          raw_data?: Json | null
          review_count?: number | null
          scraped_at?: string | null
          shop_type?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          street?: string | null
          temporarily_closed?: boolean | null
          twitter_url?: string | null
          updated_at?: string | null
          website?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      email_events: {
        Row: {
          created_at: string | null
          email_queue_id: string | null
          event_type: string
          id: string
          ip_address: unknown
          link_url: string | null
          tracking_id: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string | null
          email_queue_id?: string | null
          event_type: string
          id?: string
          ip_address?: unknown
          link_url?: string | null
          tracking_id: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string | null
          email_queue_id?: string | null
          event_type?: string
          id?: string
          ip_address?: unknown
          link_url?: string | null
          tracking_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_email_queue_id_fkey"
            columns: ["email_queue_id"]
            isOneToOne: false
            referencedRelation: "email_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      email_queue: {
        Row: {
          body_html: string
          body_text: string | null
          contact_id: string
          created_at: string | null
          enrollment_id: string | null
          error_message: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          max_retries: number | null
          retry_count: number | null
          scheduled_for: string
          sender_account_id: string | null
          sent_at: string | null
          status: string | null
          step_id: string | null
          subject: string
          to_email: string
          tracking_id: string | null
          variant_id: string | null
          workspace_id: string
        }
        Insert: {
          body_html: string
          body_text?: string | null
          contact_id: string
          created_at?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          max_retries?: number | null
          retry_count?: number | null
          scheduled_for: string
          sender_account_id?: string | null
          sent_at?: string | null
          status?: string | null
          step_id?: string | null
          subject: string
          to_email: string
          tracking_id?: string | null
          variant_id?: string | null
          workspace_id: string
        }
        Update: {
          body_html?: string
          body_text?: string | null
          contact_id?: string
          created_at?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          max_retries?: number | null
          retry_count?: number | null
          scheduled_for?: string
          sender_account_id?: string | null
          sent_at?: string | null
          status?: string | null
          step_id?: string | null
          subject?: string
          to_email?: string
          tracking_id?: string | null
          variant_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "sequence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "gmail_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "sequence_step_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          body_text: string | null
          created_at: string | null
          id: string
          name: string
          subject: string
          updated_at: string | null
          variables: string[] | null
          workspace_id: string
        }
        Insert: {
          body_html: string
          body_text?: string | null
          created_at?: string | null
          id?: string
          name: string
          subject: string
          updated_at?: string | null
          variables?: string[] | null
          workspace_id: string
        }
        Update: {
          body_html?: string
          body_text?: string | null
          created_at?: string | null
          id?: string
          name?: string
          subject?: string
          updated_at?: string | null
          variables?: string[] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_accounts: {
        Row: {
          access_token: string | null
          created_at: string | null
          daily_sends_count: number | null
          daily_sends_reset_at: string | null
          display_name: string | null
          domain_health: Json | null
          email_address: string
          health_score: number | null
          id: string
          is_warmup: boolean | null
          max_daily_sends: number | null
          min_send_interval_seconds: number
          pause_reason: string | null
          refresh_token: string | null
          signature: string | null
          signature_html: string | null
          status: string | null
          target_daily_sends: number | null
          token_expires_at: string | null
          updated_at: string | null
          user_id: string
          warmup_day: number | null
          warmup_enabled: boolean | null
          warmup_stage: string | null
          warmup_start_date: string | null
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string | null
          daily_sends_count?: number | null
          daily_sends_reset_at?: string | null
          display_name?: string | null
          domain_health?: Json | null
          email_address: string
          health_score?: number | null
          id?: string
          is_warmup?: boolean | null
          max_daily_sends?: number | null
          min_send_interval_seconds?: number
          pause_reason?: string | null
          refresh_token?: string | null
          signature?: string | null
          signature_html?: string | null
          status?: string | null
          target_daily_sends?: number | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id: string
          warmup_day?: number | null
          warmup_enabled?: boolean | null
          warmup_stage?: string | null
          warmup_start_date?: string | null
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string | null
          daily_sends_count?: number | null
          daily_sends_reset_at?: string | null
          display_name?: string | null
          domain_health?: Json | null
          email_address?: string
          health_score?: number | null
          id?: string
          is_warmup?: boolean | null
          max_daily_sends?: number | null
          min_send_interval_seconds?: number
          pause_reason?: string | null
          refresh_token?: string | null
          signature?: string | null
          signature_html?: string | null
          status?: string | null
          target_daily_sends?: number | null
          token_expires_at?: string | null
          updated_at?: string | null
          user_id?: string
          warmup_day?: number | null
          warmup_enabled?: boolean | null
          warmup_stage?: string | null
          warmup_start_date?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmail_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_messages: {
        Row: {
          body_html: string | null
          body_text: string | null
          body_translated_en: string | null
          category: string
          contact_id: string | null
          created_at: string
          detected_language: string | null
          draft_en: string | null
          draft_generated_at: string | null
          draft_model: string | null
          email_queue_id: string | null
          from_email: string
          from_name: string | null
          gmail_account_id: string
          gmail_message_id: string
          gmail_thread_id: string
          id: string
          is_auto_reply: boolean | null
          is_read: boolean
          received_at: string
          subject: string | null
          subject_translated_en: string | null
          translation_model: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          body_translated_en?: string | null
          category?: string
          contact_id?: string | null
          created_at?: string
          detected_language?: string | null
          draft_en?: string | null
          draft_generated_at?: string | null
          draft_model?: string | null
          email_queue_id?: string | null
          from_email: string
          from_name?: string | null
          gmail_account_id: string
          gmail_message_id: string
          gmail_thread_id: string
          id?: string
          is_auto_reply?: boolean | null
          is_read?: boolean
          received_at: string
          subject?: string | null
          subject_translated_en?: string | null
          translation_model?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          body_translated_en?: string | null
          category?: string
          contact_id?: string | null
          created_at?: string
          detected_language?: string | null
          draft_en?: string | null
          draft_generated_at?: string | null
          draft_model?: string | null
          email_queue_id?: string | null
          from_email?: string
          from_name?: string | null
          gmail_account_id?: string
          gmail_message_id?: string
          gmail_thread_id?: string
          id?: string
          is_auto_reply?: boolean | null
          is_read?: boolean
          received_at?: string
          subject?: string | null
          subject_translated_en?: string | null
          translation_model?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_email_queue_id_fkey"
            columns: ["email_queue_id"]
            isOneToOne: false
            referencedRelation: "email_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_gmail_account_id_fkey"
            columns: ["gmail_account_id"]
            isOneToOne: false
            referencedRelation: "gmail_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string | null
          id: string
          name: string
          stages: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          stages?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          stages?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospector_saved_searches: {
        Row: {
          created_at: string
          filters: Json
          id: string
          last_run_at: string | null
          name: string
          result_count: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          filters: Json
          id?: string
          last_run_at?: string | null
          name: string
          result_count?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          last_run_at?: string | null
          name?: string
          result_count?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospector_saved_searches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospector_search_cache: {
        Row: {
          expires_at: string
          filters: Json
          id: string
          pagination: Json
          results: Json
          search_hash: string
          searched_at: string
          workspace_id: string
        }
        Insert: {
          expires_at: string
          filters: Json
          id?: string
          pagination: Json
          results: Json
          search_hash: string
          searched_at?: string
          workspace_id: string
        }
        Update: {
          expires_at?: string
          filters?: Json
          id?: string
          pagination?: Json
          results?: Json
          search_hash?: string
          searched_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospector_search_cache_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      route_stops: {
        Row: {
          company_id: string | null
          discovered_shop_id: string | null
          follow_up_required: boolean | null
          id: string
          latitude: number
          leg_drive_meters: number | null
          leg_drive_seconds: number | null
          longitude: number
          route_id: string
          shop_address: string
          shop_name: string
          stop_order: number
          visit_notes: string | null
          visit_outcome: string | null
          visited_at: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          discovered_shop_id?: string | null
          follow_up_required?: boolean | null
          id?: string
          latitude: number
          leg_drive_meters?: number | null
          leg_drive_seconds?: number | null
          longitude: number
          route_id: string
          shop_address: string
          shop_name: string
          stop_order: number
          visit_notes?: string | null
          visit_outcome?: string | null
          visited_at?: string | null
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          discovered_shop_id?: string | null
          follow_up_required?: boolean | null
          id?: string
          latitude?: number
          leg_drive_meters?: number | null
          leg_drive_seconds?: number | null
          longitude?: number
          route_id?: string
          shop_address?: string
          shop_name?: string
          stop_order?: number
          visit_notes?: string | null
          visit_outcome?: string | null
          visited_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_discovered_shop_id_fkey"
            columns: ["discovered_shop_id"]
            isOneToOne: false
            referencedRelation: "discovered_shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "daily_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stops_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_enrollments: {
        Row: {
          completed_at: string | null
          contact_id: string
          current_step: number | null
          enrolled_at: string | null
          id: string
          sender_account_id: string | null
          sequence_id: string
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          current_step?: number | null
          enrolled_at?: string | null
          id?: string
          sender_account_id?: string | null
          sequence_id: string
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          current_step?: number | null
          enrolled_at?: string | null
          id?: string
          sender_account_id?: string | null
          sequence_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_sender_account_id_fkey"
            columns: ["sender_account_id"]
            isOneToOne: false
            referencedRelation: "gmail_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_step_variants: {
        Row: {
          ai_generated: boolean
          ai_generation_model: string | null
          ai_parent_variant_id: string | null
          body_html: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sends_count: number
          sequence_step_id: string
          subject: string
          updated_at: string
          weight: number
          workspace_id: string
        }
        Insert: {
          ai_generated?: boolean
          ai_generation_model?: string | null
          ai_parent_variant_id?: string | null
          body_html?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sends_count?: number
          sequence_step_id: string
          subject?: string
          updated_at?: string
          weight?: number
          workspace_id: string
        }
        Update: {
          ai_generated?: boolean
          ai_generation_model?: string | null
          ai_parent_variant_id?: string | null
          body_html?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sends_count?: number
          sequence_step_id?: string
          subject?: string
          updated_at?: string
          weight?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_step_variants_ai_parent_variant_id_fkey"
            columns: ["ai_parent_variant_id"]
            isOneToOne: false
            referencedRelation: "sequence_step_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_step_variants_sequence_step_id_fkey"
            columns: ["sequence_step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_step_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          body_override: string | null
          condition_branch_no: number | null
          condition_branch_yes: number | null
          condition_type: string | null
          created_at: string | null
          cta_lock: string | null
          delay_days: number | null
          delay_hours: number | null
          id: string
          include_signature: boolean
          sequence_id: string
          step_order: number
          subject_override: string | null
          template_id: string | null
          type: string | null
        }
        Insert: {
          body_override?: string | null
          condition_branch_no?: number | null
          condition_branch_yes?: number | null
          condition_type?: string | null
          created_at?: string | null
          cta_lock?: string | null
          delay_days?: number | null
          delay_hours?: number | null
          id?: string
          include_signature?: boolean
          sequence_id: string
          step_order: number
          subject_override?: string | null
          template_id?: string | null
          type?: string | null
        }
        Update: {
          body_override?: string | null
          condition_branch_no?: number | null
          condition_branch_yes?: number | null
          condition_type?: string | null
          created_at?: string | null
          cta_lock?: string | null
          delay_days?: number | null
          delay_hours?: number | null
          id?: string
          include_signature?: boolean
          sequence_id?: string
          step_order?: number
          subject_override?: string | null
          template_id?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          settings: Json | null
          status: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          settings?: Json | null
          status?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          settings?: Json | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      snippets: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snippets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          company_id: string
          created_at: string
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          mrr_cents: number | null
          plan: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          company_id: string
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          mrr_cents?: number | null
          plan?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          company_id?: string
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          mrr_cents?: number | null
          plan?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressions: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          domain: string | null
          email: string | null
          id: string
          reason: string
          source: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          domain?: string | null
          email?: string | null
          id?: string
          reason: string
          source?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          domain?: string | null
          email?: string | null
          id?: string
          reason?: string
          source?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppressions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          description: string | null
          due_date: string | null
          enrollment_id: string | null
          id: string
          priority: string
          snoozed_until: string | null
          title: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          enrollment_id?: string | null
          id?: string
          priority?: string
          snoozed_until?: string | null
          title: string
          type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          enrollment_id?: string | null
          id?: string
          priority?: string
          snoozed_until?: string | null
          title?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "sequence_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      template_versions: {
        Row: {
          body_html: string
          created_at: string
          id: string
          name: string
          subject: string
          template_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          body_html: string
          created_at?: string
          id?: string
          name: string
          subject: string
          template_id: string
          version: number
          workspace_id: string
        }
        Update: {
          body_html?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string
          template_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      unsubscribes: {
        Row: {
          email: string
          id: string
          reason: string | null
          source: string | null
          unsubscribed_at: string | null
          workspace_id: string
        }
        Insert: {
          email: string
          id?: string
          reason?: string | null
          source?: string | null
          unsubscribed_at?: string | null
          workspace_id: string
        }
        Update: {
          email?: string
          id?: string
          reason?: string | null
          source?: string | null
          unsubscribed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unsubscribes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          event_at: string
          event_type: string
          external_id: string | null
          id: string
          metadata: Json
          source: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          event_at: string
          event_type: string
          external_id?: string | null
          id?: string
          metadata?: Json
          source?: string | null
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          event_at?: string
          event_type?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          source?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          full_name: string | null
          origin_address: string | null
          origin_geocoded_at: string | null
          origin_latitude: number | null
          origin_longitude: number | null
          signature_html: string | null
          signature_updated_at: string | null
          title: string | null
          updated_at: string
          user_id: string
          working_days: Json
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          origin_address?: string | null
          origin_geocoded_at?: string | null
          origin_latitude?: number | null
          origin_longitude?: number | null
          signature_html?: string | null
          signature_updated_at?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          working_days?: Json
        }
        Update: {
          created_at?: string
          full_name?: string | null
          origin_address?: string | null
          origin_geocoded_at?: string | null
          origin_latitude?: number | null
          origin_longitude?: number | null
          signature_html?: string | null
          signature_updated_at?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          working_days?: Json
        }
        Relationships: []
      }
      user_unavailable_dates: {
        Row: {
          created_at: string
          date: string
          id: string
          reason: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          reason?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          reason?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_unavailable_dates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_ai_knowledge: {
        Row: {
          content_md: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          content_md: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          content_md?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_ai_knowledge_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_ai_settings: {
        Row: {
          created_at: string
          daily_email_gen_count: number
          daily_email_gen_date: string | null
          filter_enabled: boolean
          icp_prompt: string | null
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          daily_email_gen_count?: number
          daily_email_gen_date?: string | null
          filter_enabled?: boolean
          icp_prompt?: string | null
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          daily_email_gen_count?: number
          daily_email_gen_date?: string | null
          filter_enabled?: boolean
          icp_prompt?: string | null
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_ai_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string | null
          id: string
          role: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string | null
          domain: string | null
          domain_aliases: string[]
          google_workspace_domain: string | null
          id: string
          name: string
          sending_settings: Json | null
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          domain?: string | null
          domain_aliases?: string[]
          google_workspace_domain?: string | null
          id?: string
          name: string
          sending_settings?: Json | null
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          domain?: string | null
          domain_aliases?: string[]
          google_workspace_domain?: string | null
          id?: string
          name?: string
          sending_settings?: Json | null
          settings?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      google_ads_wl_users: {
        Row: {
          country_code: string | null
          email: string | null
          first_name: string | null
          last_name: string | null
          phone_number: string | null
          postal_code: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      find_fuzzy_company_matches: {
        Args: {
          p_country_code: string
          p_limit?: number
          p_max_sim?: number
          p_min_sim?: number
          p_name: string
          p_workspace_id: string
        }
        Returns: {
          id: string
          name: string
          org_number: string
          similarity: number
          source: string
          wl_workshop_id: string
        }[]
      }
      find_strict_company_match: {
        Args: {
          p_country_code: string
          p_min_sim?: number
          p_name: string
          p_workspace_id: string
        }
        Returns: {
          id: string
          name: string
          similarity: number
          wl_workshop_id: string
        }[]
      }
      get_next_send_time: {
        Args: {
          p_after: string
          p_end_hour: number
          p_send_days: string[]
          p_start_hour: number
          p_timezone: string
        }
        Returns: string
      }
      get_sequence_stats: { Args: { p_sequence_id: string }; Returns: Json }
      get_user_workspace_ids: { Args: never; Returns: string[] }
      immutable_unaccent: { Args: { "": string }; Returns: string }
      increment_variant_sends: {
        Args: { p_delta: number; p_variant_id: string }
        Returns: undefined
      }
      is_workspace_admin: { Args: { ws_id: string }; Returns: boolean }
      reorder_route_stops: {
        Args: {
          p_estimated_day_seconds: number
          p_google_maps_deeplink: string
          p_route_id: string
          p_routes_api_response: Json
          p_stop_orders: Json
          p_total_drive_meters: number
          p_total_drive_seconds: number
          p_workspace_id: string
        }
        Returns: undefined
      }
      reset_daily_send_counts: { Args: never; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
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
