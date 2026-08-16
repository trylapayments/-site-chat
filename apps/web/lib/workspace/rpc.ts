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

/**
 * Same as callPublicRpc for functions that accept NULL for an argument
 * (e.g. `update_canned_response(p_shortcut, p_folder_id)` clearing a shortcut or
 * unfiling a snippet).
 *
 * Postgres does not record argument nullability, so `supabase gen types` always
 * emits non-nullable primitives (postgres-meta#842). `database.types.ts` is
 * diffed byte-for-byte against the generator in CI, so the nulls are widened
 * here instead of hand-editing the generated file.
 */
export function callPublicRpcNullable<T extends PublicFunctionName>(
  supabase: AppSupabaseClient,
  fn: T,
  args: { [K in keyof PublicFunctionArgs<T>]: PublicFunctionArgs<T>[K] | null },
) {
  return supabase.rpc(fn, args as PublicFunctionArgs<T> & undefined);
}

/**
 * Validate an RPC payload against its schema. RPCs return `jsonb`, so the shape
 * is only guaranteed once parsed.
 */
export function parseRpcResult<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
  data: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid ${label} response`);
  }
  return parsed.data as T;
}
