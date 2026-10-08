import { z } from "zod";
const company = z.object({ id: z.string().uuid(), name: z.string() });
export const accountDeletionPreviewSchema = z.object({
  email: z.string().email(),
  personalCompanies: z.array(company),
  sharedCompanies: z.array(company),
  blockers: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      workspaceId: z.string().uuid().optional(),
    }),
  ),
});
export type AccountDeletionPreview = z.infer<
  typeof accountDeletionPreviewSchema
>;
export const deleteOwnAccountInputSchema = z
  .object({
    confirmation: z.string().email().max(254),
    password: z.string().min(1).max(1024),
  })
  .strict();
export const deleteOwnAccountResultSchema = z.discriminatedUnion("deleted", [
  z.object({ deleted: z.literal(true) }),
  z.object({
    deleted: z.literal(false),
    preview: accountDeletionPreviewSchema,
  }),
]);
