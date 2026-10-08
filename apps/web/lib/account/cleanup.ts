import "server-only";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env.server";
import type { Database } from "@site-chat/shared";
type CleanupRow = {
  id: string;
  user_id: string;
  bucket: "agent-avatars" | "attachments" | "widget-assets";
  path: string;
  created_at: string;
};
type CleanupDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      process_account_deletion_workspace: {
        Args: Record<string, never>;
        Returns: { pending: boolean };
      };
    };
    Tables: Database["public"]["Tables"] & {
      account_deletion_storage_cleanup: {
        Row: CleanupRow;
        Insert: CleanupRow;
        Update: Partial<CleanupRow>;
        Relationships: [];
      };
    };
  };
};
const jobSchema = z.object({
  id: z.string().uuid(),
  bucket: z.enum(["agent-avatars", "attachments", "widget-assets"]),
  path: z.string().min(1),
});
export async function processAccountDeletionCleanup() {
  const service = createClient<CleanupDatabase>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(3000) }),
      },
    },
  );
  let workspacePending = false;
  for (let batch = 0; batch < 4; batch++) {
    const result = await service.rpc("process_account_deletion_workspace", {});
    if (result.error) {
      workspacePending = true;
      break;
    }
    workspacePending = result.data.pending;
    if (!workspacePending) break;
  }
  const { data, error } = await service
    .from("account_deletion_storage_cleanup")
    .select("id,bucket,path")
    .order("created_at")
    .limit(100);
  if (error) return { removed: 0, pending: true };
  let removed = 0;
  const jobs = z.array(jobSchema).parse(data);
  let storagePending = false;
  for (const bucket of [
    "agent-avatars",
    "attachments",
    "widget-assets",
  ] as const) {
    const group = jobs.filter((job) => job.bucket === bucket);
    if (!group.length) continue;
    const deleted = await service.storage
      .from(bucket)
      .remove(group.map((job) => job.path));
    if (deleted.error) {
      storagePending = true;
      continue;
    }
    const finished = await service
      .from("account_deletion_storage_cleanup")
      .delete()
      .in(
        "id",
        group.map((job) => job.id),
      );
    if (!finished.error) removed += group.length;
    else storagePending = true;
  }
  return {
    removed,
    pending: workspacePending || storagePending || jobs.length === 100,
  };
}
