import type { ConversationDetail } from "@site-chat/shared";
import { z } from "zod";

const detailChangeSchema = z.object({
  status: z.string(),
  assigned_to: z.string().nullable(),
  assignment_version: z.number().int().nonnegative().optional(),
});

/** Message/profile writes bump updated_at without changing assignment/status. */
export function conversationChangeNeedsDetailRefresh(
  current: Pick<
    ConversationDetail,
    "status" | "assigned_to" | "assignment_version"
  >,
  raw: Record<string, unknown>,
): boolean {
  const parsed = detailChangeSchema.safeParse(raw);
  if (!parsed.success) return true;
  const change = parsed.data;
  return (
    change.status !== current.status ||
    change.assigned_to !== (current.assigned_to?.member_id ?? null) ||
    (change.assignment_version !== undefined &&
      change.assignment_version !== (current.assignment_version ?? 0))
  );
}
