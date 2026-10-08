import "server-only";
import {
  createClient as createAuthClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database, Json } from "@site-chat/shared";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { loadChargebeeBilling } from "@/lib/billing/chargebee";
import {
  accountDeletionPreviewSchema,
  deleteOwnAccountInputSchema,
  deleteOwnAccountResultSchema,
} from "./schema";
export class AccountDeletionError extends Error {}
type AccountDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      own_account_deletion_preview: {
        Args: Record<string, never>;
        Returns: Json;
      };
      delete_own_account: { Args: { p_confirmation: string }; Returns: Json };
    };
  };
};
export async function accountDeletionPreview(client: AppSupabaseClient) {
  const { data, error } = await (
    client as unknown as SupabaseClient<AccountDatabase>
  ).rpc("own_account_deletion_preview", {});
  if (error)
    throw new AccountDeletionError(
      "Unable to load account deletion details. Please try again.",
    );
  return accountDeletionPreviewSchema.parse(data);
}
export async function deleteOwnAccount(
  client: AppSupabaseClient,
  input: unknown,
) {
  const parsed = deleteOwnAccountInputSchema.parse(input);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user?.email)
    throw new AccountDeletionError("Please sign in again.");
  if (parsed.confirmation !== user.email)
    throw new AccountDeletionError("Type your exact account email to confirm.");
  const reauthenticated = createAuthClient<AccountDatabase>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await reauthenticated.auth.signInWithPassword({
    email: user.email,
    password: parsed.password,
  });
  try {
    if (signedIn.error || signedIn.data.user.id !== user.id)
      throw new AccountDeletionError(
        "Unable to verify your password. Please try again.",
      );
    const preview = await accountDeletionPreview(client);
    // Refresh only the caller's personal companies; never trust client workspace IDs or stale billing.
    await Promise.all(
      preview.personalCompanies.map((c) => loadChargebeeBilling(c.id)),
    );
    const { data, error: deletionError } = await reauthenticated.rpc(
      "delete_own_account",
      { p_confirmation: parsed.confirmation },
    );
    if (deletionError)
      throw new AccountDeletionError(
        "Unable to confirm account deletion. Sign in again to check your account or contact support.",
      );
    return deleteOwnAccountResultSchema.parse(data);
  } finally {
    await reauthenticated.auth
      .signOut({ scope: "local" })
      .catch(() => undefined);
  }
}
