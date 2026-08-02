import type { Database } from "@site-chat/shared";

import type { AppSupabaseClient } from "@/lib/supabase/server";

type PublicFunctionName = keyof Database["public"]["Functions"];
type PublicFunctionArgs<T extends PublicFunctionName> =
  Database["public"]["Functions"][T]["Args"];

/**
 * Typed RPC helper bridging Database function signatures to Supabase client rpc().
 */
export function callPublicRpc<T extends PublicFunctionName>(
  supabase: AppSupabaseClient,
  fn: T,
  args?: PublicFunctionArgs<T>,
) {
  return supabase.rpc(fn, args as PublicFunctionArgs<T> & undefined);
}
