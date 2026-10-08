import { expect, it, vi } from "vitest";
import { visitorContactMembership } from "./address-book";
import type { AppSupabaseClient } from "@/lib/supabase/server";
const workspaceId = "20000000-0000-4000-8000-000000000001";
const visitorSessionId = "30000000-0000-4000-8000-000000000001";
const contactId = "10000000-0000-4000-8000-000000000001";
it("scopes read and save to the authorized workspace", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { contactId, saved: true }, error: null });
  const client = { rpc } as unknown as AppSupabaseClient;
  await expect(
    visitorContactMembership(client, workspaceId, { visitorSessionId }),
  ).resolves.toEqual({ contactId, saved: true });
  await visitorContactMembership(
    client,
    workspaceId,
    { visitorSessionId },
    true,
  );
  expect(rpc).toHaveBeenNthCalledWith(1, "visitor_contact_membership", {
    p_workspace_id: workspaceId,
    p_visitor_session_id: visitorSessionId,
  });
  expect(rpc).toHaveBeenNthCalledWith(2, "save_visitor_contact", {
    p_workspace_id: workspaceId,
    p_visitor_session_id: visitorSessionId,
  });
});
it("rejects malformed and extra parameters before RPC", async () => {
  const rpc = vi.fn();
  const client = { rpc } as unknown as AppSupabaseClient;
  await expect(
    visitorContactMembership(
      client,
      workspaceId,
      { visitorSessionId: "bad" },
      true,
    ),
  ).rejects.toThrow();
  await expect(
    visitorContactMembership(
      client,
      workspaceId,
      { visitorSessionId, workspaceId: "other" },
      true,
    ),
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves authorization errors and rejects invalid results", async () => {
  const error = { message: "FORBIDDEN" };
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error })
    .mockResolvedValueOnce({
      data: { contactId: "bad", saved: true },
      error: null,
    });
  const client = { rpc } as unknown as AppSupabaseClient;
  await expect(
    visitorContactMembership(client, workspaceId, { visitorSessionId }, true),
  ).rejects.toBe(error);
  await expect(
    visitorContactMembership(client, workspaceId, { visitorSessionId }),
  ).rejects.toThrow();
});
