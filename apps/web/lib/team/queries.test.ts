import { describe, expect, it, vi } from "vitest";

import type { AppSupabaseClient } from "@/lib/supabase/server";

import {
  createWorkspaceInvitation,
  fetchWorkspaceTeam,
  removeWorkspaceMember,
} from "./queries";

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

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";

const VALID_TEAM = {
  members: [
    {
      member_id: MEMBER_ID,
      user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "owner@local.test",
      display_label: "owner@local.test",
      role: "owner",
      status: "active",
      joined_at: "2026-01-01T00:00:00.000Z",
      assigned_conversation_count: 2,
    },
  ],
  invitations: [
    {
      invitation_id: "66666666-6666-4666-8666-666666666666",
      email: "invitee@local.test",
      role: "viewer",
      created_at: "2026-01-02T00:00:00.000Z",
      expires_at: "2026-01-09T00:00:00.000Z",
    },
  ],
};

describe("team queries", () => {
  it("parses list_workspace_team payloads", async () => {
    const { supabase, rpc } = fakeSupabase({ data: VALID_TEAM });
    const result = await fetchWorkspaceTeam(supabase, WORKSPACE_ID);
    expect(result.members).toHaveLength(1);
    expect(result.invitations[0]?.email).toBe("invitee@local.test");
    expect(rpc).toHaveBeenCalledWith("list_workspace_team", {
      p_workspace_id: WORKSPACE_ID,
    });
  });

  it("creates invitations through the existing RPC", async () => {
    const { supabase, rpc } = fakeSupabase({
      data: {
        invitation_id: "66666666-6666-4666-8666-666666666666",
        token: "invite-token",
      },
    });
    const result = await createWorkspaceInvitation(supabase, WORKSPACE_ID, {
      email: "new@local.test",
      role: "agent",
    });
    expect(result.token).toBe("invite-token");
    expect(rpc).toHaveBeenCalledWith("create_workspace_invitation", {
      p_workspace_id: WORKSPACE_ID,
      p_email: "new@local.test",
      p_role: "agent",
    });
  });

  it("maps last-owner remove errors", async () => {
    const { supabase } = fakeSupabase({
      error: { message: "Workspace must have at least one active owner" },
    });
    await expect(
      removeWorkspaceMember(supabase, { memberId: MEMBER_ID }),
    ).rejects.toMatchObject({ code: "LAST_OWNER" });
  });

  it("maps agent invite denial", async () => {
    const { supabase } = fakeSupabase({
      error: { message: "Only owners and admins can create invitations" },
    });
    await expect(
      createWorkspaceInvitation(supabase, WORKSPACE_ID, {
        email: "blocked@local.test",
        role: "viewer",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
