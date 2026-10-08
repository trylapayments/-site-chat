import type { Database, Json } from "@site-chat/shared";

type DeviceRow = {
  id: string;
  user_id: string;
  installation_id: string;
  workspace_id: string;
  member_id: string;
  token: string;
  sound_mode: "mill" | "voice" | "silent" | "system";
  updated_at: string;
  push_new_chat?: boolean;
  push_new_visitor?: boolean;
  push_messages?: boolean;
};
type OutboxRow = {
  id: string;
  notification_id: string;
  device_id: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  claimed_at: string | null;
  ticket_id: string | null;
  receipt_checked_at: string | null;
  created_at: string;
};
type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Row>;
  Relationships: [];
};
// Proposed contract only. Regenerate canonical Database after approved migration rollout.
export type MobileDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      mobile_push_devices: Table<
        DeviceRow,
        Omit<DeviceRow, "id" | "updated_at"> & { updated_at?: string }
      >;
      mobile_push_outbox: Table<OutboxRow>;
      mobile_push_visitor_outbox: Table<
        Omit<OutboxRow, "notification_id"> & { visitor_session_id: string }
      >;
    };
    Functions: Database["public"]["Functions"] & {
      register_mobile_push: {
        Args: {
          p_user_id: string;
          p_member_id: string;
          p_workspace_id: string;
          p_installation_id: string;
          p_token: string;
          p_sound_mode: string;
          p_push_new_chat?: boolean;
          p_push_new_visitor?: boolean;
          p_push_messages?: boolean;
        };
        Returns: undefined;
      };
      claim_mobile_push: { Args: { p_limit: number }; Returns: Json };
      claim_mobile_visitor_push: { Args: { p_limit: number }; Returns: Json };
    };
  };
};
