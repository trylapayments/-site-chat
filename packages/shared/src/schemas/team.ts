import { z } from "zod";

const memberRoleSchema = z.enum(["owner", "admin", "agent", "viewer"]);
const inviteRoleSchema = z.enum(["admin", "agent", "viewer"]);
const memberStatusSchema = z.enum(["active", "deactivated"]);

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address")
  .max(320);

export const teamMemberSchema = z
  .object({
    member_id: z.string().uuid(),
    user_id: z.string().uuid(),
    email: z.string(),
    display_label: z.string(),
    role: memberRoleSchema,
    status: memberStatusSchema,
    joined_at: z.string(),
    assigned_conversation_count: z.number().int().nonnegative(),
  })
  .strict();

export const teamInvitationSchema = z
  .object({
    invitation_id: z.string().uuid(),
    email: z.string(),
    role: inviteRoleSchema,
    created_at: z.string(),
    expires_at: z.string(),
  })
  .strict();

export const listWorkspaceTeamResultSchema = z
  .object({
    members: z.array(teamMemberSchema),
    invitations: z.array(teamInvitationSchema),
  })
  .strict();

export const createWorkspaceInvitationInputSchema = z
  .object({
    email: emailSchema,
    role: inviteRoleSchema,
  })
  .strict();

export const createWorkspaceInvitationResultSchema = z
  .object({
    invitation_id: z.string().uuid(),
    token: z.string().min(1),
  })
  .strict();

export const updateWorkspaceMemberRoleInputSchema = z
  .object({
    memberId: z.string().uuid(),
    role: memberRoleSchema,
  })
  .strict();

export const workspaceMemberIdInputSchema = z
  .object({
    memberId: z.string().uuid(),
  })
  .strict();

export const revokeWorkspaceInvitationInputSchema = z
  .object({
    invitationId: z.string().uuid(),
  })
  .strict();

export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamInvitation = z.infer<typeof teamInvitationSchema>;
export type ListWorkspaceTeamResult = z.infer<typeof listWorkspaceTeamResultSchema>;
export type CreateWorkspaceInvitationInput = z.infer<typeof createWorkspaceInvitationInputSchema>;
export type CreateWorkspaceInvitationResult = z.infer<typeof createWorkspaceInvitationResultSchema>;
export type UpdateWorkspaceMemberRoleInput = z.infer<typeof updateWorkspaceMemberRoleInputSchema>;
export type WorkspaceMemberIdInput = z.infer<typeof workspaceMemberIdInputSchema>;
export type RevokeWorkspaceInvitationInput = z.infer<typeof revokeWorkspaceInvitationInputSchema>;
export type InviteRole = z.infer<typeof inviteRoleSchema>;
export type TeamMemberStatus = z.infer<typeof memberStatusSchema>;
