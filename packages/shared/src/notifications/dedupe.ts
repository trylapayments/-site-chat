/**
 * Durable notification dedupe key builders.
 * Every logical event maps to at most one durable notification per recipient.
 */

export function mentionNotificationDedupeKey(mentionRowId: string): string {
  return `mention:${mentionRowId}`;
}

export function conversationNewDedupeKey(conversationId: string, memberId: string): string {
  return `conversation_new:${conversationId}:member:${memberId}`;
}

export function visitorMessageDedupeKey(messageId: string, memberId?: string): string {
  if (memberId) {
    return `visitor_message:${messageId}:member:${memberId}`;
  }
  return `visitor_message:${messageId}`;
}

export function assignmentNotificationDedupeKey(
  conversationId: string,
  assignmentVersion: number,
): string {
  return `conversation_assigned:${conversationId}:v${String(assignmentVersion)}`;
}

export function transferFromDedupeKey(conversationId: string, assignmentVersion: number): string {
  return `conversation_transferred_from:${conversationId}:v${String(assignmentVersion)}`;
}

export function unassignNotificationDedupeKey(
  conversationId: string,
  assignmentVersion: number,
): string {
  return `conversation_unassigned:${conversationId}:v${String(assignmentVersion)}`;
}

export function emailOutboxDedupeKey(notificationDedupeKey: string): string {
  return `email:${notificationDedupeKey.slice(0, 190)}`;
}
