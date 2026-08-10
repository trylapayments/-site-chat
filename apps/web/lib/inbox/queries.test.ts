import { describe, expect, it, vi } from "vitest";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import { updateVisitorProfile } from "./queries";

function fakeSupabase(rpcResult: {
  data?: unknown;
  error?: { message: string } | null;
}): { supabase: AppSupabaseClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn().mockResolvedValue({
    data: rpcResult.data,
    error: rpcResult.error ?? null,
  });
  return { supabase: { rpc } as unknown as AppSupabaseClient, rpc };
}

const VALID_PROFILE = {
  public_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 555 0100",
  attributes: { plan: "pro" },
  first_seen_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-02T00:00:00.000Z",
  visit_count: 3,
};

describe("updateVisitorProfile contract", () => {
  it("parses an RPC payload matching visitorProfileSchema", async () => {
    const { supabase, rpc } = fakeSupabase({ data: VALID_PROFILE });

    const result = await updateVisitorProfile(
      supabase,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      { name: "Ada Lovelace" },
    );

    expect(result).toEqual(VALID_PROFILE);
    expect(rpc).toHaveBeenCalledWith("update_visitor_profile", {
      p_workspace_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      p_conversation_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      p_patch: { name: "Ada Lovelace" },
    });
  });

  it("rejects a payload leaking phone_e164 (visitorProfileSchema is .strict())", async () => {
    const { supabase } = fakeSupabase({
      data: { ...VALID_PROFILE, phone_e164: "+15550100" },
    });

    await expect(
      updateVisitorProfile(
        supabase,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        { phone: "+1 555 0100" },
      ),
    ).rejects.toThrow(/Invalid update_visitor_profile response/);
  });

  it("throws when the RPC returns an error", async () => {
    const { supabase } = fakeSupabase({ error: { message: "boom" } });

    await expect(
      updateVisitorProfile(
        supabase,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        { email: null },
      ),
    ).rejects.toEqual({ message: "boom" });
  });
});
