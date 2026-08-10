export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      ai_rate_limit_buckets: {
        Row: {
          bucket_key: string
          created_at: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          created_at?: string
          request_count?: number
          updated_at?: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          created_at?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      ai_usage_events: {
        Row: {
          completion_tokens: number | null
          created_at: string
          error_code: string | null
          feature: string
          id: string
          latency_ms: number
          member_id: string | null
          model: string | null
          prompt_tokens: number | null
          provider: string
          status: string
          total_tokens: number | null
          workspace_id: string
        }
        Insert: {
          completion_tokens?: number | null
          created_at?: string
          error_code?: string | null
          feature: string
          id?: string
          latency_ms: number
          member_id?: string | null
          model?: string | null
          prompt_tokens?: number | null
          provider: string
          status: string
          total_tokens?: number | null
          workspace_id: string
        }
        Update: {
          completion_tokens?: number | null
          created_at?: string
          error_code?: string | null
          feature?: string
          id?: string
          latency_ms?: number
          member_id?: string | null
          model?: string | null
          prompt_tokens?: number | null
          provider?: string
          status?: string
          total_tokens?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ai_usage_events_member_workspace"
            columns: ["member_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      allowed_domains: {
        Row: {
          created_at: string
          domain: string
          id: string
          verified: boolean
          workspace_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          verified?: boolean
          workspace_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          verified?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowed_domains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_uploads: {
        Row: {
          actor_role: string
          agent_member_id: string | null
          attachment_id: string
          batch_id: string
          body_draft: string
          client_message_id: string | null
          conversation_id: string
          created_at: string
          error_code: string | null
          expires_at: string
          filename: string
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["app_attachment_kind"]
          metadata_json: Json
          mime_type: string
          size_bytes: number
          sort_order: number
          status: Database["public"]["Enums"]["app_attachment_upload_status"]
          storage_key: string
          updated_at: string
          visitor_session_id: string | null
          width: number | null
          workspace_id: string
        }
        Insert: {
          actor_role: string
          agent_member_id?: string | null
          attachment_id?: string
          batch_id: string
          body_draft?: string
          client_message_id?: string | null
          conversation_id: string
          created_at?: string
          error_code?: string | null
          expires_at?: string
          filename: string
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["app_attachment_kind"]
          metadata_json?: Json
          mime_type: string
          size_bytes: number
          sort_order?: number
          status?: Database["public"]["Enums"]["app_attachment_upload_status"]
          storage_key: string
          updated_at?: string
          visitor_session_id?: string | null
          width?: number | null
          workspace_id: string
        }
        Update: {
          actor_role?: string
          agent_member_id?: string | null
          attachment_id?: string
          batch_id?: string
          body_draft?: string
          client_message_id?: string | null
          conversation_id?: string
          created_at?: string
          error_code?: string | null
          expires_at?: string
          filename?: string
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["app_attachment_kind"]
          metadata_json?: Json
          mime_type?: string
          size_bytes?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["app_attachment_upload_status"]
          storage_key?: string
          updated_at?: string
          visitor_session_id?: string | null
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_attachment_uploads_agent_member_workspace"
            columns: ["agent_member_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_attachment_uploads_conversation_workspace"
            columns: ["conversation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_attachment_uploads_visitor_session_workspace"
            columns: ["visitor_session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "visitor_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          custom_attributes_json: Json
          email: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          name: string | null
          phone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          custom_attributes_json?: Json
          email?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          custom_attributes_json?: Json
          email?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string | null
          phone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_member_reads: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          last_delivered_sequence: number
          last_read_at: string
          last_read_sequence: number
          member_id: string
          unread_count: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          last_delivered_sequence?: number
          last_read_at?: string
          last_read_sequence?: number
          member_id: string
          unread_count?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          last_delivered_sequence?: number
          last_read_at?: string
          last_read_sequence?: number
          member_id?: string
          unread_count?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_member_reads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_conversation_member_reads_conversation_workspace"
            columns: ["conversation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_conversation_member_reads_member_workspace"
            columns: ["member_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      conversation_visitor_reads: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          last_delivered_at: string | null
          last_delivered_sequence: number
          last_read_at: string | null
          last_read_sequence: number
          updated_at: string
          visitor_session_id: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          last_delivered_at?: string | null
          last_delivered_sequence?: number
          last_read_at?: string | null
          last_read_sequence?: number
          updated_at?: string
          visitor_session_id: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          last_delivered_at?: string | null
          last_delivered_sequence?: number
          last_read_at?: string | null
          last_read_sequence?: number
          updated_at?: string
          visitor_session_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_visitor_reads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_conversation_visitor_reads_conversation_workspace"
            columns: ["conversation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_conversation_visitor_reads_session_workspace"
            columns: ["visitor_session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "visitor_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          channel_type: Database["public"]["Enums"]["app_channel_type"]
          contact_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          locale: string | null
          message_count: number
          next_message_sequence: number
          referrer: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["app_conversation_status"]
          subject: string | null
          updated_at: string
          visitor_message_count: number
          visitor_realtime_topic_key: string
          visitor_session_id: string
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          channel_type?: Database["public"]["Enums"]["app_channel_type"]
          contact_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          locale?: string | null
          message_count?: number
          next_message_sequence?: number
          referrer?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["app_conversation_status"]
          subject?: string | null
          updated_at?: string
          visitor_message_count?: number
          visitor_realtime_topic_key?: string
          visitor_session_id: string
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          channel_type?: Database["public"]["Enums"]["app_channel_type"]
          contact_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          locale?: string | null
          message_count?: number
          next_message_sequence?: number
          referrer?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["app_conversation_status"]
          subject?: string | null
          updated_at?: string
          visitor_message_count?: number
          visitor_realtime_topic_key?: string
          visitor_session_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_conversations_assigned_to_workspace"
            columns: ["assigned_to", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_conversations_contact_workspace"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_conversations_resolved_by_workspace"
            columns: ["resolved_by", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_conversations_visitor_session_workspace"
            columns: ["visitor_session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "visitor_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          conversation_id: string
          created_at: string
          duration_ms: number | null
          filename: string
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["app_attachment_kind"]
          message_id: string
          metadata_json: Json
          mime_type: string
          scan_status: Database["public"]["Enums"]["app_attachment_scan_status"]
          size_bytes: number
          sort_order: number
          storage_key: string
          thumbnail_storage_key: string | null
          updated_at: string
          width: number | null
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          duration_ms?: number | null
          filename: string
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["app_attachment_kind"]
          message_id: string
          metadata_json?: Json
          mime_type: string
          scan_status?: Database["public"]["Enums"]["app_attachment_scan_status"]
          size_bytes: number
          sort_order?: number
          storage_key: string
          thumbnail_storage_key?: string | null
          updated_at?: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          duration_ms?: number | null
          filename?: string
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["app_attachment_kind"]
          message_id?: string
          metadata_json?: Json
          mime_type?: string
          scan_status?: Database["public"]["Enums"]["app_attachment_scan_status"]
          size_bytes?: number
          sort_order?: number
          storage_key?: string
          thumbnail_storage_key?: string | null
          updated_at?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_message_attachments_conversation_workspace"
            columns: ["conversation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_message_attachments_message_workspace"
            columns: ["message_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "message_attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_member_id: string | null
          body: string
          client_message_id: string | null
          conversation_id: string
          created_at: string
          delivery_status: Database["public"]["Enums"]["app_message_delivery_status"]
          id: string
          is_internal: boolean
          metadata_json: Json
          sender_type: Database["public"]["Enums"]["app_message_sender_type"]
          sequence_number: number
          updated_at: string
          visitor_session_id: string | null
          workspace_id: string
        }
        Insert: {
          agent_member_id?: string | null
          body: string
          client_message_id?: string | null
          conversation_id: string
          created_at?: string
          delivery_status?: Database["public"]["Enums"]["app_message_delivery_status"]
          id?: string
          is_internal?: boolean
          metadata_json?: Json
          sender_type: Database["public"]["Enums"]["app_message_sender_type"]
          sequence_number: number
          updated_at?: string
          visitor_session_id?: string | null
          workspace_id: string
        }
        Update: {
          agent_member_id?: string | null
          body?: string
          client_message_id?: string | null
          conversation_id?: string
          created_at?: string
          delivery_status?: Database["public"]["Enums"]["app_message_delivery_status"]
          id?: string
          is_internal?: boolean
          metadata_json?: Json
          sender_type?: Database["public"]["Enums"]["app_message_sender_type"]
          sequence_number?: number
          updated_at?: string
          visitor_session_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_messages_agent_member_workspace"
            columns: ["agent_member_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_messages_conversation_workspace"
            columns: ["conversation_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "fk_messages_visitor_session_workspace"
            columns: ["visitor_session_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "visitor_sessions"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          last_workspace_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_workspace_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_workspace_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_last_workspace_id_fkey"
            columns: ["last_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_sessions: {
        Row: {
          contact_id: string | null
          created_at: string
          current_url: string | null
          expires_at: string
          id: string
          initial_url: string | null
          locale: string
          referrer: string | null
          session_token_hash: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          current_url?: string | null
          expires_at: string
          id?: string
          initial_url?: string | null
          locale?: string
          referrer?: string | null
          session_token_hash: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          current_url?: string | null
          expires_at?: string
          id?: string
          initial_url?: string | null
          locale?: string
          referrer?: string | null
          session_token_hash?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_visitor_sessions_contact_workspace"
            columns: ["contact_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "visitor_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      widget_rate_limit_buckets: {
        Row: {
          bucket_key: string
          created_at: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          created_at?: string
          request_count?: number
          updated_at?: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          created_at?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          email_normalized: string | null
          expires_at: string
          id: string
          invited_by_user_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_member_role"]
          token_hash: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          email_normalized?: string | null
          expires_at: string
          id?: string
          invited_by_user_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_member_role"]
          token_hash: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          email_normalized?: string | null
          expires_at?: string
          id?: string
          invited_by_user_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_member_role"]
          token_hash?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["app_member_role"]
          status: Database["public"]["Enums"]["app_member_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["app_member_role"]
          status?: Database["public"]["Enums"]["app_member_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["app_member_role"]
          status?: Database["public"]["Enums"]["app_member_status"]
          updated_at?: string
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
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          settings_json: Json
          slug: string
          status: Database["public"]["Enums"]["app_workspace_status"]
          updated_at: string
          widget_public_key: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          settings_json?: Json
          slug: string
          status?: Database["public"]["Enums"]["app_workspace_status"]
          updated_at?: string
          widget_public_key: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          settings_json?: Json
          slug?: string
          status?: Database["public"]["Enums"]["app_workspace_status"]
          updated_at?: string
          widget_public_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invitation: { Args: { p_token: string }; Returns: Json }
      ai_consume_rate_limit: {
        Args: {
          p_bucket_key: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      assign_conversation: {
        Args: {
          p_assignee_member_id: string
          p_conversation_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      cancel_attachment_uploads: {
        Args: {
          p_agent_member_id?: string
          p_batch_id: string
          p_upload_ids?: string[]
          p_visitor_session_id?: string
          p_workspace_id: string
        }
        Returns: number
      }
      create_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: Json
      }
      create_workspace_invitation: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["app_member_role"]
          p_workspace_id: string
        }
        Returns: Json
      }
      deactivate_workspace_member: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      demote_workspace_owner: {
        Args: {
          p_member_id: string
          p_new_role: Database["public"]["Enums"]["app_member_role"]
        }
        Returns: undefined
      }
      finalize_operator_attachment_message: {
        Args: {
          p_attachments?: Json
          p_batch_id: string
          p_body?: string
          p_client_message_id?: string
          p_conversation_id: string
          p_upload_ids: string[]
          p_workspace_id: string
        }
        Returns: Json
      }
      finalize_visitor_attachment_message: {
        Args: {
          p_attachments?: Json
          p_batch_id: string
          p_body?: string
          p_client_message_id?: string
          p_page_url?: string
          p_referrer?: string
          p_session_token: string
          p_upload_ids: string[]
          p_workspace_id: string
        }
        Returns: Json
      }
      get_conversation: {
        Args: { p_conversation_id: string; p_workspace_id: string }
        Returns: Json
      }
      get_inbox_unread_total: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      list_accessible_workspaces: { Args: never; Returns: Json }
      list_assignable_members: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      list_conversations: {
        Args: { p_query?: Json; p_workspace_id: string }
        Returns: Json
      }
      list_messages: {
        Args: {
          p_conversation_id: string
          p_query?: Json
          p_workspace_id: string
        }
        Returns: Json
      }
      mark_attachment_uploads_uploaded: {
        Args: {
          p_batch_id: string
          p_upload_ids: string[]
          p_workspace_id: string
        }
        Returns: number
      }
      mark_conversation_delivered: {
        Args: {
          p_conversation_id: string
          p_through_sequence: number
          p_workspace_id: string
        }
        Returns: Json
      }
      mark_conversation_read: {
        Args: {
          p_conversation_id: string
          p_through_sequence?: number
          p_workspace_id: string
        }
        Returns: Json
      }
      promote_workspace_member_to_owner: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      remove_workspace_member: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      revoke_workspace_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      send_operator_message: {
        Args: {
          p_body: string
          p_client_message_id?: string
          p_conversation_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      set_last_workspace: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      soft_delete_workspace: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      update_conversation_status: {
        Args: {
          p_conversation_id: string
          p_status: Database["public"]["Enums"]["app_conversation_status"]
          p_workspace_id: string
        }
        Returns: Json
      }
      update_workspace_member_role: {
        Args: {
          p_member_id: string
          p_new_role: Database["public"]["Enums"]["app_member_role"]
        }
        Returns: undefined
      }
      validate_workspace_invitation: {
        Args: { p_token: string }
        Returns: Json
      }
      widget_authorize_visitor_attachment: {
        Args: {
          p_attachment_id: string
          p_session_token: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      widget_consume_rate_limit: {
        Args: {
          p_bucket_key: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      widget_create_or_resume_visitor_session: {
        Args: {
          p_locale?: string
          p_page_url?: string
          p_referrer?: string
          p_session_token?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      widget_ensure_conversation_for_attachments: {
        Args: {
          p_page_url?: string
          p_referrer?: string
          p_session_token: string
          p_workspace_id: string
        }
        Returns: Json
      }
      widget_list_visitor_messages: {
        Args: {
          p_after_sequence?: number
          p_before_sequence?: number
          p_limit?: number
          p_session_token: string
          p_workspace_id: string
        }
        Returns: Json
      }
      widget_mark_conversation_receipt: {
        Args: {
          p_kind: string
          p_session_token: string
          p_through_sequence: number
          p_workspace_id: string
        }
        Returns: Json
      }
      widget_resolve_public_key: {
        Args: { p_widget_public_key: string }
        Returns: Json
      }
      widget_resolve_realtime_topic: {
        Args: { p_session_token: string; p_workspace_id: string }
        Returns: Json
      }
      widget_send_visitor_message: {
        Args: {
          p_body: string
          p_client_message_id?: string
          p_page_url?: string
          p_referrer?: string
          p_session_token: string
          p_workspace_id: string
        }
        Returns: Json
      }
      widget_validate_origin: {
        Args: {
          p_origin: string
          p_require_verified?: boolean
          p_workspace_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_attachment_kind: "image" | "document"
      app_attachment_scan_status:
        | "pending"
        | "clean"
        | "infected"
        | "skipped"
        | "error"
      app_attachment_upload_status:
        | "pending"
        | "uploaded"
        | "confirmed"
        | "failed"
        | "cancelled"
        | "expired"
      app_channel_type: "widget"
      app_conversation_status: "open" | "pending" | "resolved" | "closed"
      app_member_role: "owner" | "admin" | "agent" | "viewer"
      app_member_status: "active" | "deactivated"
      app_message_delivery_status: "sent" | "delivered" | "failed"
      app_message_sender_type: "visitor" | "agent" | "system"
      app_workspace_status: "active" | "suspended" | "pending_deletion"
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
    Enums: {
      app_attachment_kind: ["image", "document"],
      app_attachment_scan_status: [
        "pending",
        "clean",
        "infected",
        "skipped",
        "error",
      ],
      app_attachment_upload_status: [
        "pending",
        "uploaded",
        "confirmed",
        "failed",
        "cancelled",
        "expired",
      ],
      app_channel_type: ["widget"],
      app_conversation_status: ["open", "pending", "resolved", "closed"],
      app_member_role: ["owner", "admin", "agent", "viewer"],
      app_member_status: ["active", "deactivated"],
      app_message_delivery_status: ["sent", "delivered", "failed"],
      app_message_sender_type: ["visitor", "agent", "system"],
      app_workspace_status: ["active", "suspended", "pending_deletion"],
    },
  },
} as const

