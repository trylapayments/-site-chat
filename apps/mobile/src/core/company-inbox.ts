import type { AccessibleWorkspace, ConversationListItem } from "@site-chat/shared";
export type CompanyConversation = ConversationListItem & {
  workspace?: { id: string; name: string; slug: string };
};
export function conversationCompany(
  conversation: CompanyConversation,
  scope: string | "all",
  workspaces: AccessibleWorkspace[],
): AccessibleWorkspace | null {
  const id = conversation.workspace?.id ?? (scope === "all" ? null : scope);
  if (!id || (scope !== "all" && id !== scope)) return null;
  return workspaces.find((workspace) => workspace.workspace_id === id) ?? null;
}
export function unreadBadge(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value > 99 ? "99+" : String(Math.floor(value));
}
