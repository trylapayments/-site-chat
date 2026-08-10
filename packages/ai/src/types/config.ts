import { z } from "zod";

import { AI_PROVIDER_IDS } from "./provider";

export const workspaceAIConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    features: z
      .object({
        suggestedReplies: z.boolean().default(false),
        summary: z.boolean().default(false),
        rag: z.boolean().default(false),
        agent: z.boolean().default(false),
      })
      .strict()
      .default({
        suggestedReplies: false,
        summary: false,
        rag: false,
        agent: false,
      }),
    provider: z.enum(AI_PROVIDER_IDS).default("openai"),
    model: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export type WorkspaceAIConfig = z.infer<typeof workspaceAIConfigSchema>;

export const DEFAULT_WORKSPACE_AI_CONFIG: WorkspaceAIConfig = {
  enabled: false,
  features: {
    suggestedReplies: false,
    summary: false,
    rag: false,
    agent: false,
  },
  provider: "openai",
};

/**
 * Parse AI config from workspaces.settings_json.ai.
 * Missing/invalid config resolves to disabled defaults (fail closed).
 */
export function parseWorkspaceAIConfig(raw: unknown): WorkspaceAIConfig {
  if (raw == null || typeof raw !== "object") {
    return DEFAULT_WORKSPACE_AI_CONFIG;
  }

  const parsed = workspaceAIConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return DEFAULT_WORKSPACE_AI_CONFIG;
  }

  return parsed.data;
}
