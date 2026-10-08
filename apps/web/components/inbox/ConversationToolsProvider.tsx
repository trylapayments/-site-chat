"use client";

import type { CannedResponse, ContactTagSummary, InternalNote, WorkspaceMemberOption } from "@site-chat/shared";
import { createContext, useContext, useEffect, useState } from "react";

export type ConversationTools = {
  members: WorkspaceMemberOption[];
  notes: InternalNote[];
  cannedResponses: CannedResponse[];
  contactTags: ContactTagSummary[];
  aiSuggestedRepliesEnabled: boolean;
};
const Context = createContext<{ ready: boolean; data: ConversationTools | null } | null>(null);

// Stream optional tools without holding up the saved conversation or composer.
// A keyed provider prevents late results from appearing in another conversation.
export function ConversationToolsProvider({ tools, value, children }: {
  tools?: Promise<ConversationTools>;
  value?: ConversationTools | null;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<ConversationTools | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!tools) return;
    let active = true;
    void tools.then((result) => { if (active) setData(result); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [tools]);
  return <Context.Provider value={{ ready: (value !== undefined ? value : data) !== null, data: value !== undefined ? value : data }}>
    {children}
    {failed ? <p role="alert" className="fixed bottom-3 right-3 rounded border bg-white p-3 text-sm">Some conversation tools could not load. Reload to retry.</p> : null}
  </Context.Provider>;
}
export function useConversationTools() { return useContext(Context); }
