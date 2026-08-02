import { requireUser } from "@/lib/auth/session";
import {
  acceptWorkspaceInvitation,
  setLastWorkspace,
} from "@/lib/workspace/queries";
import { createClient } from "@/lib/supabase/server";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "";
}

export async function acceptInvitationForUser(token: string): Promise<
  | {
      ok: true;
      slug: string;
    }
  | {
      ok: false;
      reason: "email_mismatch" | "invalid";
    }
> {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const result = await acceptWorkspaceInvitation(supabase, token);
    await setLastWorkspace(supabase, result.workspace_id);
    return { ok: true, slug: result.slug };
  } catch (error) {
    const message = getErrorMessage(error);

    if (
      message.includes("Invitation email does not match authenticated user")
    ) {
      return { ok: false, reason: "email_mismatch" };
    }

    if (message.includes("Invalid or expired invitation")) {
      return { ok: false, reason: "invalid" };
    }

    throw error;
  }
}
