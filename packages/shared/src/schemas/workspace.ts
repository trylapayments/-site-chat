import { z } from "zod";

const memberRoleSchema = z.enum(["owner", "admin", "agent", "viewer"]);

const slugSchema = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters")
  .max(63, "Slug must be at most 63 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase letters, numbers, and hyphens");

export const createWorkspaceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(100, "Name must be at most 100 characters"),
    slug: slugSchema,
  })
  .strict();

export const selectWorkspaceSchema = z
  .object({
    workspaceId: z.string().uuid("Select a workspace"),
  })
  .strict();

export const switchWorkspaceSchema = z
  .object({
    workspaceId: z.string().uuid("Select a workspace"),
    currentPath: z.string().max(2048).optional(),
  })
  .strict();

export const accessibleWorkspaceSchema = z
  .object({
    workspace_id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    role: memberRoleSchema,
  })
  .strict();

export const listAccessibleWorkspacesSchema = z
  .object({
    total_membership_count: z.number().int().nonnegative(),
    accessible_workspaces: z.array(accessibleWorkspaceSchema),
  })
  .strict();

export const validateInvitationSchema = z
  .object({
    valid: z.boolean(),
    workspace_name: z.string().nullable(),
    role: memberRoleSchema.nullable(),
    masked_email: z.string().nullable(),
    expires_at: z.string().nullable(),
  })
  .strict();

export const createWorkspaceResultSchema = z
  .object({
    workspace_id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  })
  .strict();

export const acceptInvitationResultSchema = z
  .object({
    status: z.enum(["accepted", "already_member"]),
    member_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    slug: z.string(),
  })
  .strict();

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type SelectWorkspaceInput = z.infer<typeof selectWorkspaceSchema>;
export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceSchema>;
export type AccessibleWorkspace = z.infer<typeof accessibleWorkspaceSchema>;
export type ListAccessibleWorkspacesResult = z.infer<typeof listAccessibleWorkspacesSchema>;
export type ValidateInvitationResult = z.infer<typeof validateInvitationSchema>;
export type CreateWorkspaceResult = z.infer<typeof createWorkspaceResultSchema>;
export type AcceptInvitationResult = z.infer<typeof acceptInvitationResultSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
