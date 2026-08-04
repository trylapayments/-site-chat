import type { MessageView } from "../schemas/realtime.js";
import { genericSenderLabel } from "../schemas/realtime.js";

function bySequence(a: MessageView, b: MessageView): number {
  if (a.sequenceNumber !== b.sequenceNumber) {
    return a.sequenceNumber - b.sequenceNumber;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export function mergeMessages(
  existing: MessageView[],
  incoming: MessageView[],
  pending: MessageView[] = [],
): MessageView[] {
  const byId = new Map<string, MessageView>();
  const byClientId = new Map<string, MessageView>();

  for (const message of [...existing, ...pending, ...incoming]) {
    if (byId.has(message.id)) {
      continue;
    }

    if (message.clientMessageId) {
      const prior = byClientId.get(message.clientMessageId);
      if (prior?.isOptimistic && !message.isOptimistic) {
        byId.delete(prior.id);
      }
      byClientId.set(message.clientMessageId, message);
    }

    byId.set(message.id, message);
  }

  return [...byId.values()].sort(bySequence);
}

export function maxSequenceNumber(messages: MessageView[]): number {
  return messages.reduce((max, message) => Math.max(max, message.sequenceNumber), 0);
}

export function hasSequenceGap(messages: MessageView[]): boolean {
  if (messages.length === 0) {
    return false;
  }

  const sorted = [...messages].sort(bySequence);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && current.sequenceNumber > previous.sequenceNumber + 1) {
      return true;
    }
  }

  return false;
}

export function toMessageViewFromOperatorRow(row: {
  id: string;
  sequence_number: number;
  sender_type: "visitor" | "agent" | "system";
  sender_label?: string;
  body: string;
  created_at: string;
  client_message_id?: string | null;
  is_internal?: boolean;
}): MessageView {
  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    senderType: row.sender_type,
    senderLabel: row.sender_label ?? genericSenderLabel(row.sender_type),
    body: row.body,
    createdAt: row.created_at,
    clientMessageId: row.client_message_id ?? null,
    isInternal: row.is_internal ?? false,
  };
}

export function toMessageViewFromWidgetBroadcast(message: {
  id: string;
  sequenceNumber: number;
  senderType: "visitor" | "agent" | "system";
  body: string;
  createdAt: string;
  clientMessageId: string | null;
}): MessageView {
  return {
    id: message.id,
    sequenceNumber: message.sequenceNumber,
    senderType: message.senderType,
    senderLabel: genericSenderLabel(message.senderType),
    body: message.body,
    createdAt: message.createdAt,
    clientMessageId: message.clientMessageId,
  };
}

export function toMessageViewFromWidgetHttp(message: {
  id: string;
  sequence_number: number;
  sender_type: "visitor" | "agent" | "system";
  body: string;
  created_at: string;
  client_message_id?: string | null;
}): MessageView {
  return {
    id: message.id,
    sequenceNumber: message.sequence_number,
    senderType: message.sender_type,
    senderLabel: genericSenderLabel(message.sender_type),
    body: message.body,
    createdAt: message.created_at,
    clientMessageId: message.client_message_id ?? null,
  };
}

export function createOptimisticMessage(input: {
  tempId: string;
  clientMessageId: string;
  body: string;
  senderType: "visitor" | "agent";
  senderLabel?: string;
  nextSequence: number;
}): MessageView {
  return {
    id: input.tempId,
    sequenceNumber: input.nextSequence,
    senderType: input.senderType,
    senderLabel: input.senderLabel ?? genericSenderLabel(input.senderType),
    body: input.body,
    createdAt: new Date().toISOString(),
    clientMessageId: input.clientMessageId,
    status: "pending",
    isOptimistic: true,
  };
}
