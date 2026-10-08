import type { AIChatMessage } from "../types/provider";

/**
 * Extension points for future prompt products.
 * Only suggested_reply is active in this release.
 */
export type PromptId =
  "suggested_reply" | "summary" | "classification" | "rag" | "routing" | "translation" | "agent";

export type PromptBuildResult = {
  id: PromptId;
  messages: AIChatMessage[];
  maxOutputTokens: number;
  temperature: number;
};
