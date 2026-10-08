import type { MessageAttachmentViewModel, MessageView } from "../schemas/realtime.js";
import { genericSenderLabel } from "../schemas/realtime.js";

function bySequence(a: MessageView, b: MessageView): number {
  if (a.sequenceNumber !== b.sequenceNumber) {
    return a.sequenceNumber - b.sequenceNumber;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

export function toAttachmentViewModel(raw: {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: "image" | "document";
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  sort_order?: number;
  has_thumbnail?: boolean;
}): MessageAttachmentViewModel {
  return {
    id: raw.id,
    filename: raw.filename,
    mimeType: raw.mime_type,
    sizeBytes: raw.size_bytes,
    kind: raw.kind,
    width: raw.width ?? null,
    height: raw.height ?? null,
    durationMs: raw.duration_ms ?? null,
    sortOrder: raw.sort_order ?? 0,
    hasThumbnail: raw.has_thumbnail ?? false,
  };
}

function mergeAttachmentLists(
  prior?: MessageAttachmentViewModel[],
  next?: MessageAttachmentViewModel[],
): MessageAttachmentViewModel[] | undefined {
  if (next && next.length > 0) {
    return next;
  }
  if (prior && prior.length > 0) {
    return prior;
  }
  return next ?? prior;
}

export function mergeMessages(
  existing: MessageView[],
  incoming: MessageView[],
  pending: MessageView[] = [],
): MessageView[] {
  const byId = new Map<string, MessageView>();
  const byClientId = new Map<string, MessageView>();

  for (const message of [...existing, ...pending, ...incoming]) {
    const priorById = byId.get(message.id);
    if (priorById) {
      byId.set(message.id, {
        ...priorById,
        ...message,
        attachments: mergeAttachmentLists(priorById.attachments, message.attachments),
      });
      continue;
    }

    if (message.clientMessageId) {
      const prior = byClientId.get(message.clientMessageId);
      if (
        prior &&
        !message.isOptimistic &&
        (prior.isOptimistic || prior.status === "failed" || prior.status === "pending")
      ) {
        byId.delete(prior.id);
        byId.set(message.id, {
          ...message,
          attachments: mergeAttachmentLists(prior.attachments, message.attachments),
        });
        byClientId.set(message.clientMessageId, message);
        continue;
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
  attachments?: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    kind: "image" | "document";
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
    sort_order?: number;
    has_thumbnail?: boolean;
  }>;
  metadata_json?: Record<string, unknown> | null;
}): MessageView {
  const fromRow = (row.attachments ?? []).map(toAttachmentViewModel);
  const fromMeta = extractAttachmentsFromMetadata(row.metadata_json);
  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    senderType: row.sender_type,
    senderLabel: row.sender_label ?? genericSenderLabel(row.sender_type),
    body: row.body,
    createdAt: row.created_at,
    clientMessageId: row.client_message_id ?? null,
    isInternal: row.is_internal ?? false,
    attachments: fromRow.length > 0 ? fromRow : fromMeta,
  };
}

export function extractAttachmentsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): MessageAttachmentViewModel[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const raw = metadata.attachments;
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: MessageAttachmentViewModel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.filename !== "string" ||
      typeof record.mime_type !== "string" ||
      typeof record.size_bytes !== "number" ||
      (record.kind !== "image" && record.kind !== "document")
    ) {
      continue;
    }
    result.push(
      toAttachmentViewModel({
        id: record.id,
        filename: record.filename,
        mime_type: record.mime_type,
        size_bytes: record.size_bytes,
        kind: record.kind,
        width: typeof record.width === "number" ? record.width : null,
        height: typeof record.height === "number" ? record.height : null,
        duration_ms: typeof record.duration_ms === "number" ? record.duration_ms : null,
        sort_order: typeof record.sort_order === "number" ? record.sort_order : 0,
        has_thumbnail: Boolean(record.has_thumbnail),
      }),
    );
  }
  return result;
}

export function toMessageViewFromWidgetBroadcast(message: {
  id: string;
  sequenceNumber: number;
  senderType: "visitor" | "agent" | "system";
  body: string;
  createdAt: string;
  clientMessageId: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    kind: "image" | "document";
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
    sort_order?: number;
    has_thumbnail?: boolean;
  }>;
}): MessageView {
  return {
    id: message.id,
    sequenceNumber: message.sequenceNumber,
    senderType: message.senderType,
    senderLabel: genericSenderLabel(message.senderType),
    body: message.body,
    createdAt: message.createdAt,
    clientMessageId: message.clientMessageId,
    attachments: (message.attachments ?? []).map(toAttachmentViewModel),
  };
}

export function toMessageViewFromWidgetHttp(message: {
  id: string;
  sequence_number: number;
  sender_type: "visitor" | "agent" | "system";
  body: string;
  created_at: string;
  client_message_id?: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    kind: "image" | "document";
    width?: number | null;
    height?: number | null;
    duration_ms?: number | null;
    sort_order?: number;
    has_thumbnail?: boolean;
  }>;
}): MessageView {
  return {
    id: message.id,
    sequenceNumber: message.sequence_number,
    senderType: message.sender_type,
    senderLabel: genericSenderLabel(message.sender_type),
    body: message.body,
    createdAt: message.created_at,
    clientMessageId: message.client_message_id ?? null,
    attachments: (message.attachments ?? []).map(toAttachmentViewModel),
  };
}

export function createOptimisticMessage(input: {
  tempId: string;
  clientMessageId: string;
  body: string;
  senderType: "visitor" | "agent";
  senderLabel?: string;
  nextSequence: number;
  attachments?: MessageAttachmentViewModel[];
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
    attachments: input.attachments ?? [],
  };
}
