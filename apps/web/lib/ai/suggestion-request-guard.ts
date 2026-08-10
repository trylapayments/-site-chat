/**
 * Stable request identity for Suggested Replies UI.
 * Prevents aborted/stale async continuations from mutating current state.
 */

export type SuggestionRequestToken = {
  requestId: number;
  conversationId: string;
};

export type SuggestionRequestGuard = {
  begin: (conversationId: string) => SuggestionRequestToken;
  isCurrent: (token: SuggestionRequestToken) => boolean;
  invalidate: () => void;
  resetConversation: (conversationId: string) => void;
  current: () => SuggestionRequestToken | null;
};

export function createSuggestionRequestGuard(): SuggestionRequestGuard {
  let latestRequestId = 0;
  let activeConversationId: string | null = null;

  return {
    begin(conversationId: string): SuggestionRequestToken {
      latestRequestId += 1;
      activeConversationId = conversationId;
      return { requestId: latestRequestId, conversationId };
    },
    isCurrent(token: SuggestionRequestToken): boolean {
      return (
        token.requestId === latestRequestId &&
        token.conversationId === activeConversationId
      );
    },
    invalidate(): void {
      latestRequestId += 1;
    },
    resetConversation(conversationId: string): void {
      latestRequestId += 1;
      activeConversationId = conversationId;
    },
    current(): SuggestionRequestToken | null {
      if (!activeConversationId || latestRequestId === 0) {
        return null;
      }
      return {
        requestId: latestRequestId,
        conversationId: activeConversationId,
      };
    },
  };
}
