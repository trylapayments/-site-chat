import type { GlobalSearchHit } from "@site-chat/shared";

import {
  workspaceContactsPath,
  workspaceNavPath,
} from "@/lib/dashboard/routes";

export function hrefForSearchHit(
  workspaceSlug: string,
  hit: GlobalSearchHit,
): string {
  switch (hit.type) {
    case "contact":
      return workspaceContactsPath(workspaceSlug, hit.id);
    case "conversation":
      return `${workspaceNavPath(workspaceSlug, "inbox")}/${hit.id}`;
    case "message":
    case "attachment": {
      const conversationId = hit.conversation_id;
      if (!conversationId) {
        return workspaceNavPath(workspaceSlug, "inbox");
      }
      const messageId =
        hit.message_id ?? (hit.type === "message" ? hit.id : null);
      const base = `${workspaceNavPath(workspaceSlug, "inbox")}/${conversationId}`;
      return messageId ? `${base}?message=${messageId}` : base;
    }
    case "note": {
      const conversationId = hit.conversation_id;
      if (!conversationId) {
        return workspaceNavPath(workspaceSlug, "inbox");
      }
      return `${workspaceNavPath(workspaceSlug, "inbox")}/${conversationId}?tab=notes&note=${hit.id}`;
    }
    default: {
      const _exhaustive: never = hit.type;
      return _exhaustive;
    }
  }
}
