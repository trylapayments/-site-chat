import { AIError } from "../types/errors";
import type { ConversationContext } from "../context/types";
import { buildSuggestedReplyPrompt } from "./suggested-reply";
import type { PromptBuildResult, PromptId } from "./types";

export type { PromptBuildResult, PromptId } from "./types";
export { buildSuggestedReplyPrompt } from "./suggested-reply";

/**
 * Prompt registry. Future products register builders here; inactive
 * prompt ids fail closed rather than returning stub content.
 */
export function buildPrompt(id: PromptId, context: ConversationContext): PromptBuildResult {
  switch (id) {
    case "suggested_reply":
      return buildSuggestedReplyPrompt(context);
    case "summary":
    case "classification":
    case "rag":
    case "routing":
    case "translation":
    case "agent":
      throw new AIError("AI_UNAVAILABLE", `Prompt "${id}" is not implemented.`, {
        status: 501,
        retryable: false,
      });
    default:
      throw new AIError("AI_UNAVAILABLE", "Unknown prompt.", {
        status: 501,
        retryable: false,
      });
  }
}
