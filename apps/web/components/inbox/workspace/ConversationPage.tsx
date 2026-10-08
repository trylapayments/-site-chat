"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { usePortalWorkspace, usePortalResource } from "@/components/dashboard/PortalDataProvider";
import { workspaceConversationId } from "@/lib/portal/client-route";
import type { PortalConversationData } from "@/lib/portal/conversation.server";
import type { ConversationTools } from "@/components/inbox/ConversationToolsProvider";
import { ConversationView } from "./ConversationView";
export function ConversationPage() {
 const {slug} = usePortalWorkspace();
 const id = workspaceConversationId(usePathname(), slug);
 const params = useSearchParams();
 if (!id) return <p role="alert" className="p-6">Conversation not found.</p>;
 return <ConversationResource key={`${id}:${params.get("message") ?? ""}:${params.get("note") ?? ""}`} id={id} message={params.get("message")} note={params.get("note")} />;
}
function ConversationResource({id, message, note}: {id: string; message: string | null; note: string | null}) {
 const focus = new URLSearchParams();
 if (message) focus.set("message", message);
 const core = `conversations/${id}${focus.toString() ? `?${focus}` : ""}`;
 const toolsQuery = new URLSearchParams({part: "tools"});
 if (note) toolsQuery.set("note", note);
 const {data, error, refresh} = usePortalResource<PortalConversationData>(core, 0);
 const tools = usePortalResource<ConversationTools>(`conversations/${id}?${toolsQuery}`, 0);
 if (!data) return <div role="status" className="flex flex-1 items-center justify-center gap-3 p-6">{error ?? "Loading conversation…"}{error && <button className="underline" onClick={() => {void refresh();}}>Retry</button>}</div>;
 return <>
   {error && <p role="alert" className="absolute bottom-3 right-3 z-10 rounded border bg-white p-3 text-sm">Latest messages could not refresh. <button className="underline" onClick={() => {void refresh();}}>Retry</button></p>}
   {tools.error && <p role="alert" className="absolute bottom-16 right-3 z-10 rounded border bg-white p-3 text-sm">Some conversation tools could not load. <button className="underline" onClick={() => {void tools.refresh();}}>Retry</button></p>}
   <ConversationView data={data} tools={tools.data ?? null} />
 </>;
}
