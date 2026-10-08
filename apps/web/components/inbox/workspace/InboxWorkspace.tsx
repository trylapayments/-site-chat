"use client";
import {usePathname} from "next/navigation";
import {usePortalWorkspace} from "@/components/dashboard/PortalDataProvider";
import {workspaceConversationId} from "@/lib/portal/client-route";
import {InboxBootstrap} from "./InboxBootstrap";
import {InboxEmptyState} from "./InboxEmptyState";
import {ConversationPage} from "./ConversationPage";
export function InboxWorkspace() {
 const {slug} = usePortalWorkspace();
 const id = workspaceConversationId(usePathname(), slug);
 return <InboxBootstrap>{id ? <ConversationPage /> : <InboxEmptyState />}</InboxBootstrap>;
}
