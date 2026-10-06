import type { Database, Json } from "@site-chat/shared";

type DeviceRow = {
  id: string;
  user_id: string;
  installation_id: string;
  workspace_id: string;
  member_id: string;
  token: string;
  updated_at: string;
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
    };
    Functions: Database["public"]["Functions"] & {
      claim_mobile_push: { Args: { p_limit: number }; Returns: Json };
    };
  };
};
