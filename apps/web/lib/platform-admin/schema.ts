import { z } from "zod";
import { WIDGET_STUDIO_FEATURES } from "@site-chat/shared";
import { MILL_PLANS } from "@/lib/billing/plans";
import { companyProfileSchema } from "@/lib/company/schema";
const reason = z.string().trim().min(3).max(2000);
const featureOverrides = z
  .record(z.boolean())
  .refine(
    (v) =>
      Object.keys(v).every((k) =>
        (WIDGET_STUDIO_FEATURES as readonly string[]).includes(k),
      ),
    "Unknown feature",
  );
export const platformChangeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    reason,
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("company"), payload: companyProfileSchema }),
      z.object({
        action: z.literal("plan"),
        payload: z
          .object({
            plan_id: z
              .string()
              .nullable()
              .refine(
                (id) => id === null || MILL_PLANS.some((p) => p.id === id),
              ),
            expires_at: z
              .string()
              .datetime()
              .nullable()
              .refine((v) => v === null || Date.parse(v) > Date.now()),
          })
          .strict(),
      }),
      z.object({
        action: z.literal("access"),
        payload: z
          .object({
            access_mode: z.enum(["standard", "pilot"]),
            features: featureOverrides,
            limits: z
              .object({
                websites: z
                  .number()
                  .int()
                  .min(1)
                  .max(100000)
                  .nullable()
                  .optional(),
                operator_seats: z.number().int().min(1).max(100000).nullable(),
                monthly_conversations: z
                  .number()
                  .int()
                  .min(1)
                  .max(100000000)
                  .nullable(),
                monthly_ai_requests: z
                  .number()
                  .int()
                  .min(0)
                  .max(100000000)
                  .nullable(),
                storage_mb: z.number().int().min(1).max(100000000).nullable(),
              })
              .strict(),
            override_expires_at: z.string().datetime().nullable(),
          })
          .strict(),
      }),
      z.object({
        action: z.literal("trial"),
        payload: z
          .object({
            trial_ends_at: z
              .string()
              .datetime()
              .refine((v) => Date.parse(v) > Date.now()),
          })
          .strict(),
      }),
      z.object({
        action: z.literal("status"),
        payload: z.object({ status: z.enum(["active", "suspended"]) }).strict(),
      }),
      z.object({
        action: z.literal("note"),
        payload: z
          .object({ body: z.string().trim().min(1).max(5000) })
          .strict(),
      }),
      z.object({
        action: z.literal("domain"),
        payload: z
          .object({
            domain: z
              .string()
              .trim()
              .toLowerCase()
              .max(253)
              .regex(
                /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
              ),
            operation: z.enum(["allow", "block"]),
          })
          .strict(),
      }),
      z.object({
        action: z.literal("member"),
        payload: z
          .object({
            member_id: z.string().uuid(),
            role: z.enum(["owner", "admin", "agent", "viewer"]),
            status: z.enum(["active", "deactivated"]),
          })
          .strict(),
      }),
    ]),
  })
  .strict();
export type PlatformChange = z.infer<typeof platformChangeSchema>;
