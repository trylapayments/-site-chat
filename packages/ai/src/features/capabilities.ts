/**
 * Stable AI feature capability keys.
 * Only suggested replies is implemented in application code today.
 */
export const AI_CAPABILITIES = {
  enabled: "ai.enabled",
  suggestedReplies: "ai.suggestedReplies",
  summary: "ai.summary",
  rag: "ai.rag",
  agent: "ai.agent",
} as const;

export type AICapability = (typeof AI_CAPABILITIES)[keyof typeof AI_CAPABILITIES];

export type AIFeatureFlags = {
  enabled: boolean;
  suggestedReplies: boolean;
  summary: boolean;
  rag: boolean;
  agent: boolean;
};

export const DEFAULT_AI_FEATURE_FLAGS: AIFeatureFlags = {
  enabled: false,
  suggestedReplies: false,
  summary: false,
  rag: false,
  agent: false,
};

export function resolveAIFeatureFlags(input: {
  enabled?: boolean;
  features?: Partial<Pick<AIFeatureFlags, "suggestedReplies" | "summary" | "rag" | "agent">>;
}): AIFeatureFlags {
  const enabled = input.enabled === true;
  const features = input.features ?? {};

  return {
    enabled,
    suggestedReplies: enabled && features.suggestedReplies === true,
    // Reserved for future product surfaces — keep off until implemented.
    summary: enabled && features.summary === true,
    rag: enabled && features.rag === true,
    agent: enabled && features.agent === true,
  };
}

export function isCapabilityEnabled(flags: AIFeatureFlags, capability: AICapability): boolean {
  switch (capability) {
    case AI_CAPABILITIES.enabled:
      return flags.enabled;
    case AI_CAPABILITIES.suggestedReplies:
      return flags.suggestedReplies;
    case AI_CAPABILITIES.summary:
      return flags.summary;
    case AI_CAPABILITIES.rag:
      return flags.rag;
    case AI_CAPABILITIES.agent:
      return flags.agent;
    default:
      return false;
  }
}
