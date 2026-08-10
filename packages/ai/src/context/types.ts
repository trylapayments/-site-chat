export type ContextSenderType = "visitor" | "agent" | "system";

export type ContextMessage = {
  id: string;
  sequenceNumber: number;
  senderType: ContextSenderType;
  body: string;
  createdAt: string;
};

export type ConversationContextInput = {
  workspace: {
    id: string;
    name: string;
  };
  operator?: {
    id: string;
    displayName?: string | null;
  };
  visitor?: {
    displayName?: string | null;
  };
  messages: ContextMessage[];
};

export type ConversationContext = {
  workspace: {
    id: string;
    name: string;
  };
  operator: {
    id: string;
    displayName: string | null;
  } | null;
  visitor: {
    displayName: string | null;
  } | null;
  messages: ContextMessage[];
};

export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 20;
export const DEFAULT_CONTEXT_MESSAGE_BODY_MAX = 1000;
