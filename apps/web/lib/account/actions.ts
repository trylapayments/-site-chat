"use server";
import { createClient } from "@/lib/supabase/server";
import {
  accountDeletionPreview,
  deleteOwnAccount,
  AccountDeletionError,
} from "./service";
export async function accountDeletionPreviewAction() {
  return accountDeletionPreview(await createClient());
}
export async function deleteOwnAccountAction(input: unknown) {
  const client = await createClient();
  try {
    const result = await deleteOwnAccount(client, input);
    if (result.deleted)
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { success: true as const, result };
  } catch (error) {
    return {
      success: false as const,
      message:
        error instanceof AccountDeletionError
          ? error.message
          : "Unable to delete your account. Please try again or contact support.",
    };
  }
}
