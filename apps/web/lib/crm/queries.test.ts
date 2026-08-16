import { describe, expect, it, vi } from "vitest";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import { fetchContactProfile, fetchContacts } from "./queries";

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

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const VALID_PROFILE = {
  id: CONTACT_ID,
  public_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: null,
  job_title: null,
  locale: null,
  country_code: null,
  attributes: {},
  first_seen_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-02T00:00:00.000Z",
  visit_count: 2,
  conversation_count: 1,
  attachment_count: 0,
  company: null,
  tags: [],
  custom_fields: [],
  current_assignee: null,
  device_summary: null,
  updated_at: "2026-01-02T00:00:00.000Z",
};

describe("CRM queries contract", () => {
  it("parses get_contact_profile payloads", async () => {
    const { supabase, rpc } = fakeSupabase({ data: VALID_PROFILE });

    const result = await fetchContactProfile(
      supabase,
      WORKSPACE_ID,
      CONTACT_ID,
    );

    expect(result).toEqual(VALID_PROFILE);
    expect(rpc).toHaveBeenCalledWith("get_contact_profile", {
      p_workspace_id: WORKSPACE_ID,
      p_contact_id: CONTACT_ID,
    });
  });

  it("parses list_contacts payloads", async () => {
    const { supabase, rpc } = fakeSupabase({
      data: { items: [], next_before: null, has_more: false },
    });

    const result = await fetchContacts(supabase, WORKSPACE_ID, { q: "ada" });

    expect(result.has_more).toBe(false);
    expect(rpc.mock.calls[0]?.[0]).toBe("list_contacts");
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_workspace_id: WORKSPACE_ID,
      p_query: { q: "ada", limit: 25 },
    });
  });

  it("maps typed CRM RPC errors", async () => {
    const { supabase } = fakeSupabase({
      error: { message: "CONTACT_NOT_FOUND: Contact not found." },
    });

    await expect(
      fetchContactProfile(supabase, WORKSPACE_ID, CONTACT_ID),
    ).rejects.toMatchObject({ code: "CONTACT_NOT_FOUND" });
  });

  it("rejects leaked fields on contact profile (strict schema)", async () => {
    const { supabase } = fakeSupabase({
      data: { ...VALID_PROFILE, phone_e164: "+15550100" },
    });

    await expect(
      fetchContactProfile(supabase, WORKSPACE_ID, CONTACT_ID),
    ).rejects.toThrow(/Invalid get_contact_profile response/);
  });
});
