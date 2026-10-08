import { z } from "zod";
import { conversationListItemSchema, listConversationsQuerySchema } from "./conversation.js";
export const allConversationsQuerySchema = listConversationsQuerySchema;
export const allConversationListItemSchema = conversationListItemSchema.extend({ workspace: z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() }).strict() }).strict();
export const allConversationsResultSchema = z.object({ items: z.array(allConversationListItemSchema), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive() }).strict();
export type AllConversationListItem = z.infer<typeof allConversationListItemSchema>;
export const workspaceInboxesResultSchema = z.object({ workspaces: z.array(z.object({ workspace_id: z.string().uuid(), slug: z.string(), name: z.string(), role: z.enum(["owner", "admin", "agent", "viewer"]), member_id: z.string().uuid(), unread_total: z.number().int().nonnegative() }).strict()) }).strict();
export const deleteCompanyInputSchema = z.object({ confirmation: z.string().min(1).max(200) }).strict();
export const deleteCompanyResultSchema = z.object({ deleted: z.literal(true), accountRetained: z.literal(true) }).strict();
