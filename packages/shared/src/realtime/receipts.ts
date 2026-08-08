/**
 * Shared read-receipt contracts: conversation-level delivered/seen cursors.
 *
 * Receipt state is never written per message. Clients derive UI status from:
 *   message.sequenceNumber <= peer.lastDeliveredSequence → delivered
 *   message.sequenceNumber <= peer.lastReadSequence → seen
 *
 * Ephemeral Broadcast (`receipt.v1`) mirrors durable cursor advances for
 * realtime UX; Postgres remains the source of truth for catch-up.
 */

import { z } from "zod";

import { ephemeralActorRoleSchema, type EphemeralActorRole } from "./ephemeral.js";

/** Versioned Broadcast event name for read/delivered cursor advances. */
export const RECEIPT_BROADCAST_EVENT = "receipt.v1" as const;

export const receiptKindSchema = z.enum(["delivered", "read"]);
export type ReceiptKind = z.infer<typeof receiptKindSchema>;

export const receiptBroadcastPayloadSchema = z
  .object({
    v: z.literal(1),
    actorRole: ephemeralActorRoleSchema,
    actorKey: z.string().min(1).max(128),
    kind: receiptKindSchema,
    lastDeliveredSequence: z.number().int().nonnegative(),
    lastReadSequence: z.number().int().nonnegative(),
  })
  .strict();

export type ReceiptBroadcastPayload = z.infer<typeof receiptBroadcastPayloadSchema>;

export type MessageReceiptStatus = "sent" | "delivered" | "seen";

export type ReceiptCursors = {
  lastDeliveredSequence: number;
  lastReadSequence: number;
};

export function parseReceiptBroadcastPayload(raw: unknown): ReceiptBroadcastPayload | null {
  const parsed = receiptBroadcastPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function buildReceiptBroadcastPayload(input: {
  actorRole: EphemeralActorRole;
  actorKey: string;
  kind: ReceiptKind;
  lastDeliveredSequence: number;
  lastReadSequence: number;
}): ReceiptBroadcastPayload {
  return {
    v: 1,
    actorRole: input.actorRole,
    actorKey: input.actorKey,
    kind: input.kind,
    lastDeliveredSequence: Math.max(0, Math.floor(input.lastDeliveredSequence)),
    lastReadSequence: Math.max(0, Math.floor(input.lastReadSequence)),
  };
}

/**
 * Derive sent → delivered → seen for a message owned by the local party,
 * using the peer's conversation-level receipt cursors.
 */
export function deriveMessageReceiptStatus(input: {
  sequenceNumber: number;
  peer: ReceiptCursors;
}): MessageReceiptStatus {
  const sequence = input.sequenceNumber;
  if (sequence <= 0) {
    return "sent";
  }

  if (sequence <= input.peer.lastReadSequence) {
    return "seen";
  }

  if (sequence <= input.peer.lastDeliveredSequence) {
    return "delivered";
  }

  return "sent";
}

/**
 * Monotonic merge of receipt cursors (GREATEST semantics). Returns whether
 * either cursor advanced — used to skip duplicate writes / broadcasts.
 */
export function mergeReceiptCursors(
  current: ReceiptCursors,
  incoming: Partial<ReceiptCursors>,
): { next: ReceiptCursors; advanced: boolean } {
  const nextDelivered = Math.max(
    current.lastDeliveredSequence,
    incoming.lastDeliveredSequence ?? current.lastDeliveredSequence,
  );
  const nextRead = Math.max(
    current.lastReadSequence,
    incoming.lastReadSequence ?? current.lastReadSequence,
  );

  // Read implies delivered through the same watermark.
  const coalescedDelivered = Math.max(nextDelivered, nextRead);

  const next = {
    lastDeliveredSequence: coalescedDelivered,
    lastReadSequence: nextRead,
  };

  const advanced =
    next.lastDeliveredSequence > current.lastDeliveredSequence ||
    next.lastReadSequence > current.lastReadSequence;

  return { next, advanced };
}

/**
 * Apply a validated receipt broadcast into local peer cursors.
 * Ignores echoes from the local actor key.
 */
export function applyRemoteReceiptEvent(input: {
  cursors: ReceiptCursors;
  payload: ReceiptBroadcastPayload;
  localActorKey?: string | null;
  /** Only apply events from this role (e.g. operators listen for visitor). */
  expectedRole?: EphemeralActorRole;
}): { cursors: ReceiptCursors; advanced: boolean } {
  if (input.localActorKey && input.payload.actorKey === input.localActorKey) {
    return { cursors: input.cursors, advanced: false };
  }

  if (input.expectedRole && input.payload.actorRole !== input.expectedRole) {
    return { cursors: input.cursors, advanced: false };
  }

  const merged = mergeReceiptCursors(input.cursors, {
    lastDeliveredSequence: input.payload.lastDeliveredSequence,
    lastReadSequence: input.payload.lastReadSequence,
  });

  return { cursors: merged.next, advanced: merged.advanced };
}

/**
 * O(1) unread arithmetic for optimistic list updates.
 * Visitor messages increase unread; mark-read clears or reduces.
 */
export function computeUnreadAfterVisitorMessage(currentUnread: number): number {
  return Math.max(0, currentUnread) + 1;
}

export function computeUnreadAfterMarkRead(input: {
  currentUnread: number;
  cleared: boolean;
  remainingUnread?: number;
}): number {
  if (input.cleared) {
    return 0;
  }

  if (input.remainingUnread !== undefined) {
    return Math.max(0, input.remainingUnread);
  }

  return Math.max(0, input.currentUnread);
}

export function unreadTotalFromConversations(
  items: ReadonlyArray<{ unread_count?: number; has_unread?: boolean }>,
): number {
  let total = 0;
  for (const item of items) {
    if (typeof item.unread_count === "number") {
      total += Math.max(0, item.unread_count);
    } else if (item.has_unread) {
      total += 1;
    }
  }
  return total;
}
