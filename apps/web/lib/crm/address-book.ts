import type { Database, Json } from "@site-chat/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AppSupabaseClient } from "@/lib/supabase/server";

// Temporary narrow RPC contract; regenerate Database after the approved migration.
type AddressBookDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      visitor_contact_membership: {
        Args: { p_workspace_id: string; p_visitor_session_id: string };
        Returns: Json;
      };
      save_visitor_contact: {
        Args: { p_workspace_id: string; p_visitor_session_id: string };
        Returns: Json;
      };
    };
  };
};
const inputSchema = z.object({ visitorSessionId: z.string().uuid() }).strict();
const resultSchema = z
  .object({ contactId: z.string().uuid().nullable(), saved: z.boolean() })
  .strict();

export async function visitorContactMembership(
  client: AppSupabaseClient,
  workspaceId: string,
  input: unknown,
  save = false,
) {
  const { visitorSessionId } = inputSchema.parse(input);
  const addressBook = client as unknown as SupabaseClient<AddressBookDatabase>;
  const { data, error } = await addressBook.rpc(
    save ? "save_visitor_contact" : "visitor_contact_membership",
    { p_workspace_id: workspaceId, p_visitor_session_id: visitorSessionId },
  );
  if (error) throw error;
  return resultSchema.parse(data);
}
