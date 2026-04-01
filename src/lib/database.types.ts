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
  daily_limit_per_sender: number;
  stop_on_reply: boolean;
  stop_on_company_reply: boolean;
  sender_rotation: boolean;
};

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          domain: string | null;
          google_workspace_domain: string | null;
          settings: Json | null;
          sending_settings: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          domain?: string | null;
          google_workspace_domain?: string | null;
          settings?: Json | null;
          sending_settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          domain?: string | null;
          google_workspace_domain?: string | null;
          settings?: Json | null;
          sending_settings?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          phone: string | null;
          company_id: string | null;
          status: "active" | "bounced" | "unsubscribed" | "archived";
          lead_status: "new" | "contacted" | "qualified" | "customer" | "churned";
          custom_fields: Json | null;
          last_contacted_at: string | null;
          source: string | null;
          title: string | null;
          city: string | null;
          country: string | null;
          linkedin_url: string | null;
          seniority: string | null;
          email_status: string;
          email_verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          phone?: string | null;
          company_id?: string | null;
          status?: "active" | "bounced" | "unsubscribed" | "archived";
          lead_status?: "new" | "contacted" | "qualified" | "customer" | "churned";
          custom_fields?: Json | null;
          last_contacted_at?: string | null;
          source?: string | null;
          title?: string | null;
          city?: string | null;
          country?: string | null;
          linkedin_url?: string | null;
          seniority?: string | null;
          email_status?: string;
          email_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          phone?: string | null;
          company_id?: string | null;
          status?: "active" | "bounced" | "unsubscribed" | "archived";
          lead_status?: "new" | "contacted" | "qualified" | "customer" | "churned";
          custom_fields?: Json | null;
          last_contacted_at?: string | null;
          source?: string | null;
          title?: string | null;
          city?: string | null;
          country?: string | null;
          linkedin_url?: string | null;
          seniority?: string | null;
          email_status?: string;
          email_verified_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          domain: string | null;
          industry: string | null;
          employee_count: number | null;
          annual_revenue: number | null;
          custom_fields: Json | null;
          country: string | null;
          city: string | null;
          linkedin_url: string | null;
          tech_stack: string[] | null;
          revenue_range: string | null;
          founded_year: number | null;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          domain?: string | null;
          industry?: string | null;
          employee_count?: number | null;
          annual_revenue?: number | null;
          custom_fields?: Json | null;
          country?: string | null;
          city?: string | null;
          linkedin_url?: string | null;
          tech_stack?: string[] | null;
          revenue_range?: string | null;
          founded_year?: number | null;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          domain?: string | null;
          industry?: string | null;
          employee_count?: number | null;
          annual_revenue?: number | null;
          custom_fields?: Json | null;
          country?: string | null;
          city?: string | null;
          linkedin_url?: string | null;
          tech_stack?: string[] | null;
          revenue_range?: string | null;
          founded_year?: number | null;
          description?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      pipelines: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          stages: PipelineStage[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          stages?: PipelineStage[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          stages?: PipelineStage[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pipelines_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      deals: {
        Row: {
          id: string;
          workspace_id: string;
          pipeline_id: string;
          name: string;
          amount: number | null;
          stage: string;
          probability: number | null;
          company_id: string | null;
          owner_id: string | null;
          expected_close_date: string | null;
          custom_fields: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          pipeline_id: string;
          name: string;
          amount?: number | null;
          stage: string;
          probability?: number | null;
          company_id?: string | null;
          owner_id?: string | null;
          expected_close_date?: string | null;
          custom_fields?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          pipeline_id?: string;
          name?: string;
          amount?: number | null;
          stage?: string;
          probability?: number | null;
          company_id?: string | null;
          owner_id?: string | null;
          expected_close_date?: string | null;
          custom_fields?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deals_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey";
            columns: ["pipeline_id"];
            isOneToOne: false;
            referencedRelation: "pipelines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      deal_contacts: {
        Row: {
          id: string;
          deal_id: string;
          contact_id: string;
          role: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          contact_id: string;
          role?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          contact_id?: string;
          role?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deal_contacts_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deal_contacts_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      activities: {
        Row: {
          id: string;
          workspace_id: string;
          type: string;
          subject: string | null;
          description: string | null;
          contact_id: string | null;
          company_id: string | null;
          deal_id: string | null;
          user_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          type: string;
          subject?: string | null;
          description?: string | null;
          contact_id?: string | null;
          company_id?: string | null;
          deal_id?: string | null;
          user_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          type?: string;
          subject?: string | null;
          description?: string | null;
          contact_id?: string | null;
          company_id?: string | null;
          deal_id?: string | null;
          user_id?: string | null;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "activities_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_lists: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          is_dynamic: boolean | null;
          filters: Json | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          is_dynamic?: boolean | null;
          filters?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          description?: string | null;
          is_dynamic?: boolean | null;
          filters?: Json | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contact_lists_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_list_members: {
        Row: {
          id: string;
          list_id: string;
          contact_id: string;
          added_at: string;
        };
        Insert: {
          id?: string;
          list_id: string;
          contact_id: string;
          added_at?: string;
        };
        Update: {
          id?: string;
          list_id?: string;
          contact_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_list_members_list_id_fkey";
            columns: ["list_id"];
            isOneToOne: false;
            referencedRelation: "contact_lists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_list_members_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      email_templates: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          subject: string;
          body_html: string;
          body_text: string | null;
          category: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          subject: string;
          body_html: string;
          body_text?: string | null;
          category?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          subject?: string;
          body_html?: string;
          body_text?: string | null;
          category?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_templates_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sequences: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          status: "draft" | "active" | "paused" | "archived";
          settings: SequenceSettings;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          status?: "draft" | "active" | "paused" | "archived";
          settings?: SequenceSettings;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          status?: "draft" | "active" | "paused" | "archived";
          settings?: SequenceSettings;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequences_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sequence_steps: {
        Row: {
          id: string;
          sequence_id: string;
          step_order: number;
          type: "email" | "delay" | "condition";
          delay_days: number | null;
          delay_hours: number | null;
          template_id: string | null;
          subject_override: string | null;
          body_override: string | null;
          condition_type: "opened" | "clicked" | "replied" | null;
          condition_branch_yes: number | null;
          condition_branch_no: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sequence_id: string;
          step_order: number;
          type: "email" | "delay" | "condition";
          delay_days?: number | null;
          delay_hours?: number | null;
          template_id?: string | null;
          subject_override?: string | null;
          body_override?: string | null;
          condition_type?: "opened" | "clicked" | "replied" | null;
          condition_branch_yes?: number | null;
          condition_branch_no?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sequence_id?: string;
          step_order?: number;
          type?: "email" | "delay" | "condition";
          delay_days?: number | null;
          delay_hours?: number | null;
          template_id?: string | null;
          subject_override?: string | null;
          body_override?: string | null;
          condition_type?: "opened" | "clicked" | "replied" | null;
          condition_branch_yes?: number | null;
          condition_branch_no?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "sequences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_steps_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "email_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      sequence_enrollments: {
        Row: {
          id: string;
          sequence_id: string;
          contact_id: string;
          sender_account_id: string | null;
          status: string | null;
          current_step: number | null;
          enrolled_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          sequence_id: string;
          contact_id: string;
          sender_account_id?: string | null;
          status?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          sequence_id?: string;
          contact_id?: string;
          sender_account_id?: string | null;
          status?: string | null;
          current_step?: number | null;
          enrolled_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "sequences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      email_queue: {
        Row: {
          id: string;
          workspace_id: string;
          enrollment_id: string;
          step_id: string;
          contact_id: string;
          sender_account_id: string;
          to_email: string;
          subject: string;
          body_html: string;
          status: "pending" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
          scheduled_for: string;
          sent_at: string | null;
          tracking_id: string;
          gmail_message_id: string | null;
          gmail_thread_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          enrollment_id: string;
          step_id: string;
          contact_id: string;
          sender_account_id: string;
          to_email: string;
          subject: string;
          body_html: string;
          status?: "pending" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
          scheduled_for: string;
          sent_at?: string | null;
          tracking_id?: string;
          gmail_message_id?: string | null;
          gmail_thread_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          enrollment_id?: string;
          step_id?: string;
          contact_id?: string;
          sender_account_id?: string;
          to_email?: string;
          subject?: string;
          body_html?: string;
          status?: "pending" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
          scheduled_for?: string;
          sent_at?: string | null;
          tracking_id?: string;
          gmail_message_id?: string | null;
          gmail_thread_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_queue_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_queue_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: false;
            referencedRelation: "sequence_enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_queue_step_id_fkey";
            columns: ["step_id"];
            isOneToOne: false;
            referencedRelation: "sequence_steps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_queue_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_queue_sender_account_id_fkey";
            columns: ["sender_account_id"];
            isOneToOne: false;
            referencedRelation: "gmail_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      email_events: {
        Row: {
          id: string;
          tracking_id: string;
          email_queue_id: string;
          event_type: "open" | "click" | "reply" | "bounce" | "unsubscribe";
          link_url: string | null;
          user_agent: string | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tracking_id: string;
          email_queue_id: string;
          event_type: "open" | "click" | "reply" | "bounce" | "unsubscribe";
          link_url?: string | null;
          user_agent?: string | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tracking_id?: string;
          email_queue_id?: string;
          event_type?: "open" | "click" | "reply" | "bounce" | "unsubscribe";
          link_url?: string | null;
          user_agent?: string | null;
          ip_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "email_events_email_queue_id_fkey";
            columns: ["email_queue_id"];
            isOneToOne: false;
            referencedRelation: "email_queue";
            referencedColumns: ["id"];
          },
        ];
      };
      gmail_accounts: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          email_address: string;
          display_name: string | null;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          daily_sends_count: number;
          max_daily_sends: number;
          status: string;
          pause_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          email_address: string;
          display_name?: string | null;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          daily_sends_count?: number;
          max_daily_sends?: number;
          status?: string;
          pause_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          email_address?: string;
          display_name?: string | null;
          access_token?: string;
          refresh_token?: string;
          token_expires_at?: string;
          daily_sends_count?: number;
          max_daily_sends?: number;
          status?: string;
          pause_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gmail_accounts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      inbox_messages: {
        Row: {
          id: string;
          workspace_id: string;
          gmail_account_id: string;
          gmail_message_id: string;
          gmail_thread_id: string;
          email_queue_id: string | null;
          contact_id: string | null;
          from_email: string;
          from_name: string | null;
          subject: string | null;
          body_html: string | null;
          body_text: string | null;
          received_at: string;
          is_read: boolean;
          is_auto_reply: boolean;
          category: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          gmail_account_id: string;
          gmail_message_id: string;
          gmail_thread_id: string;
          email_queue_id?: string | null;
          contact_id?: string | null;
          from_email: string;
          from_name?: string | null;
          subject?: string | null;
          body_html?: string | null;
          body_text?: string | null;
          received_at: string;
          is_read?: boolean;
          is_auto_reply?: boolean;
          category?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          gmail_account_id?: string;
          gmail_message_id?: string;
          gmail_thread_id?: string;
          email_queue_id?: string | null;
          contact_id?: string | null;
          from_email?: string;
          from_name?: string | null;
          subject?: string | null;
          body_html?: string | null;
          body_text?: string | null;
          received_at?: string;
          is_read?: boolean;
          is_auto_reply?: boolean;
          category?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inbox_messages_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inbox_messages_gmail_account_id_fkey";
            columns: ["gmail_account_id"];
            isOneToOne: false;
            referencedRelation: "gmail_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inbox_messages_email_queue_id_fkey";
            columns: ["email_queue_id"];
            isOneToOne: false;
            referencedRelation: "email_queue";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inbox_messages_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      suppressions: {
        Row: {
          id: string;
          workspace_id: string;
          email: string | null;
          domain: string | null;
          reason: string;
          source: string | null;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email?: string | null;
          domain?: string | null;
          reason: string;
          source?: string | null;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string | null;
          domain?: string | null;
          reason?: string;
          source?: string | null;
          active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppressions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      unsubscribes: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "unsubscribes_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      prospector_saved_searches: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          filters: Json;
          last_run_at: string | null;
          result_count: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          filters: Json;
          last_run_at?: string | null;
          result_count?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          name?: string;
          filters?: Json;
          last_run_at?: string | null;
          result_count?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      prospector_search_cache: {
        Row: {
          id: string;
          workspace_id: string;
          search_hash: string;
          filters: Json;
          results: Json;
          pagination: Json;
          searched_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          search_hash: string;
          filters: Json;
          results: Json;
          pagination: Json;
          searched_at?: string;
          expires_at: string;
        };
        Update: {
          id?: string;
          results?: Json;
          pagination?: Json;
          searched_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      snippets: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          category: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          category?: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          category?: string;
          body?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      template_versions: {
        Row: {
          id: string;
          template_id: string;
          workspace_id: string;
          version: number;
          name: string;
          subject: string;
          body_html: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          template_id: string;
          workspace_id: string;
          version: number;
          name: string;
          subject: string;
          body_html: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_workspace_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      get_next_send_time: {
        Args: {
          p_after: string;
          p_send_days: number[];
          p_start_hour: number;
          p_end_hour: number;
          p_timezone: string;
        };
        Returns: string;
      };
      get_sequence_stats: {
        Args: {
          p_sequence_id: string;
        };
        Returns: Json;
      };
      reset_daily_send_counts: {
        Args: Record<string, never>;
        Returns: void;
      };
    };
    Enums: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
