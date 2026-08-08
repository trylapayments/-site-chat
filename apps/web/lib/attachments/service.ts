import "server-only";

import {
  ATTACHMENT_LIMITS,
  StubAntivirusScanner,
  buildAttachmentStorageKey,
  contentDispositionAttachment,
  createUploadBroadcastPayload,
  isAntivirusAllowlisted,
  type AntivirusScanner,
  type InitiateUploadsData,
  type MessageAttachmentView,
  type ObjectStorage,
  type ValidatedAttachmentFile,
  validateAttachmentBatch,
  validateMagicBytesAgainstDeclared,
} from "@site-chat/shared";
import { randomUUID } from "node:crypto";

import {
  createSignedImageThumbnailUrl,
  createSupabaseObjectStorage,
} from "@/lib/storage/supabase-object-storage";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { callPublicRpc } from "@/lib/workspace/rpc";
import type { Json } from "@site-chat/shared";

export type InitiateUploadFileInput = {
  localId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
};

export type AttachmentServiceDeps = {
  storage?: ObjectStorage;
  antivirus?: AntivirusScanner;
};

function getStorage(deps?: AttachmentServiceDeps): ObjectStorage {
  return deps?.storage ?? createSupabaseObjectStorage();
}

function getAntivirus(deps?: AttachmentServiceDeps): AntivirusScanner {
  return deps?.antivirus ?? new StubAntivirusScanner();
}

async function resolveVisitorConversationId(input: {
  workspaceId: string;
  sessionToken: string;
  pageUrl?: string | null;
  referrer?: string | null;
}): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc(
    "widget_ensure_conversation_for_attachments",
    {
      p_workspace_id: input.workspaceId,
      p_session_token: input.sessionToken,
      p_page_url: input.pageUrl ?? undefined,
      p_referrer: input.referrer ?? undefined,
    },
  );

  if (error) {
    throw error;
  }

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).conversation_id === "string"
  ) {
    return (data as Record<string, unknown>).conversation_id as string;
  }

  throw new Error("Unable to resolve conversation for attachments");
}

export async function initiateVisitorUploads(
  input: {
    workspaceId: string;
    sessionToken: string;
    files: InitiateUploadFileInput[];
    body?: string;
    clientMessageId?: string;
    pageUrl?: string | null;
    referrer?: string | null;
  },
  deps?: AttachmentServiceDeps,
): Promise<InitiateUploadsData> {
  const batch = validateAttachmentBatch(
    input.files.map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  );

  if (!batch.ok) {
    throw new AttachmentValidationError(batch.error.code, batch.error.message);
  }

  const conversationId = await resolveVisitorConversationId({
    workspaceId: input.workspaceId,
    sessionToken: input.sessionToken,
    pageUrl: input.pageUrl,
    referrer: input.referrer,
  });

  return createUploadIntents(
    {
      workspaceId: input.workspaceId,
      conversationId,
      files: input.files,
      validated: batch.value,
      actorRole: "visitor",
      sessionToken: input.sessionToken,
      clientMessageId: input.clientMessageId,
      bodyDraft: input.body ?? "",
    },
    deps,
  );
}

export async function initiateOperatorUploads(
  input: {
    workspaceId: string;
    conversationId: string;
    memberId: string;
    files: InitiateUploadFileInput[];
    body?: string;
    clientMessageId?: string;
  },
  deps?: AttachmentServiceDeps,
): Promise<InitiateUploadsData> {
  const batch = validateAttachmentBatch(
    input.files.map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  );

  if (!batch.ok) {
    throw new AttachmentValidationError(batch.error.code, batch.error.message);
  }

  return createUploadIntents(
    {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      files: input.files,
      validated: batch.value,
      actorRole: "operator",
      memberId: input.memberId,
      clientMessageId: input.clientMessageId,
      bodyDraft: input.body ?? "",
    },
    deps,
  );
}

async function createUploadIntents(
  input: {
    workspaceId: string;
    conversationId: string;
    files: InitiateUploadFileInput[];
    validated: ValidatedAttachmentFile[];
    actorRole: "visitor" | "operator";
    sessionToken?: string;
    memberId?: string;
    clientMessageId?: string;
    bodyDraft: string;
  },
  deps?: AttachmentServiceDeps,
): Promise<InitiateUploadsData> {
  const storage = getStorage(deps);
  const supabase = createServiceClient();
  const batchId = randomUUID();

  let visitorSessionId: string | null = null;
  if (input.actorRole === "visitor" && input.sessionToken) {
    visitorSessionId = await resolveVisitorSessionId(
      input.workspaceId,
      input.sessionToken,
    );
  }

  const uploads = [];

  for (let index = 0; index < input.validated.length; index += 1) {
    const validated = input.validated[index];
    const source = input.files[index];
    if (!validated || !source) {
      continue;
    }
    const attachmentId = randomUUID();
    const uploadId = randomUUID();
    const storageKey = buildAttachmentStorageKey({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      attachmentId,
      filename: validated.filename,
    });

    const signed = await storage.createSignedUploadUrl({
      path: storageKey,
      contentType: validated.mimeType,
      expiresInSeconds: ATTACHMENT_LIMITS.signedUploadTtlSeconds,
      upsert: false,
    });

    const { error } = await supabase.from("attachment_uploads").insert({
      id: uploadId,
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      batch_id: batchId,
      attachment_id: attachmentId,
      storage_key: storageKey,
      filename: validated.filename,
      mime_type: validated.mimeType,
      size_bytes: validated.sizeBytes,
      kind: validated.kind,
      width: source.width ?? null,
      height: source.height ?? null,
      sort_order: index,
      status: "pending",
      actor_role: input.actorRole,
      visitor_session_id: visitorSessionId,
      agent_member_id: input.memberId ?? null,
      client_message_id: input.clientMessageId ?? null,
      body_draft: input.bodyDraft,
      expires_at: new Date(
        Date.now() + ATTACHMENT_LIMITS.uploadIntentTtlSeconds * 1000,
      ).toISOString(),
      metadata_json: { localId: source.localId },
    });

    if (error) {
      throw error;
    }

    uploads.push({
      localId: source.localId,
      uploadId,
      attachmentId,
      storageKey,
      uploadUrl: signed.url,
      uploadToken: signed.token,
      expiresAt: signed.expiresAt,
      headers: signed.headers,
      filename: validated.filename,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      kind: validated.kind,
    });
  }

  return {
    batchId,
    conversationId: input.conversationId,
    uploads,
  };
}

async function resolveVisitorSessionId(
  workspaceId: string,
  sessionToken: string,
): Promise<string> {
  const supabase = createServiceClient();
  // widget_resolve_realtime_topic validates the token; session id via digest match.
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(sessionToken).digest("hex");
  const { data, error } = await supabase
    .from("visitor_sessions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("session_token_hash", hash)
    .maybeSingle();

  if (error || !data) {
    throw new Error("SESSION_EXPIRED");
  }

  return data.id;
}

async function uploadsAlreadyConfirmed(input: {
  workspaceId: string;
  batchId: string;
  uploadIds: string[];
}): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("attachment_uploads")
    .select("status")
    .eq("workspace_id", input.workspaceId)
    .eq("batch_id", input.batchId)
    .in("id", input.uploadIds);

  if (error || data.length !== input.uploadIds.length) {
    return false;
  }

  return data.every((row) => row.status === "confirmed");
}

export async function completeVisitorUploads(
  input: {
    workspaceId: string;
    sessionToken: string;
    batchId: string;
    uploadIds: string[];
    body?: string;
    clientMessageId?: string;
    pageUrl?: string | null;
    referrer?: string | null;
  },
  deps?: AttachmentServiceDeps,
) {
  const supabase = createServiceClient();

  // Idempotent retry: if uploads are already confirmed, finalize returns the
  // existing message via client_message_id without re-validating storage.
  if (
    input.clientMessageId &&
    (await uploadsAlreadyConfirmed({
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      uploadIds: input.uploadIds,
    }))
  ) {
    const { data, error } = await supabase.rpc(
      "finalize_visitor_attachment_message",
      {
        p_workspace_id: input.workspaceId,
        p_session_token: input.sessionToken,
        p_batch_id: input.batchId,
        p_upload_ids: input.uploadIds,
        p_body: input.body ?? "",
        p_client_message_id: input.clientMessageId,
        p_page_url: input.pageUrl ?? undefined,
        p_referrer: input.referrer ?? undefined,
        p_attachments: [],
      },
    );
    if (error) {
      throw error;
    }
    return data;
  }

  const prepared = await prepareUploadsForFinalize(
    {
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      uploadIds: input.uploadIds,
    },
    deps,
  );

  const { data, error } = await supabase.rpc(
    "finalize_visitor_attachment_message",
    {
      p_workspace_id: input.workspaceId,
      p_session_token: input.sessionToken,
      p_batch_id: input.batchId,
      p_upload_ids: input.uploadIds,
      p_body: input.body ?? "",
      p_client_message_id: input.clientMessageId,
      p_page_url: input.pageUrl ?? undefined,
      p_referrer: input.referrer ?? undefined,
      p_attachments: prepared.attachmentRows,
    },
  );

  if (error) {
    // Only delete objects that were not yet confirmed as durable attachments.
    await cleanupFailedObjects(prepared.storageKeys, deps);
    throw error;
  }

  return data;
}

export async function completeOperatorUploads(
  input: {
    workspaceId: string;
    conversationId: string;
    batchId: string;
    uploadIds: string[];
    body?: string;
    clientMessageId?: string;
    /** Authenticated Supabase client — required so RLS/auth.uid() checks pass. */
    authedClient: AppSupabaseClient;
  },
  deps?: AttachmentServiceDeps,
) {
  if (
    input.clientMessageId &&
    (await uploadsAlreadyConfirmed({
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      uploadIds: input.uploadIds,
    }))
  ) {
    const { data, error } = await callPublicRpc(
      input.authedClient,
      "finalize_operator_attachment_message",
      {
        p_workspace_id: input.workspaceId,
        p_conversation_id: input.conversationId,
        p_batch_id: input.batchId,
        p_upload_ids: input.uploadIds,
        p_body: input.body ?? "",
        p_client_message_id: input.clientMessageId,
        p_attachments: [] as Json,
      },
    );
    if (error) {
      throw error;
    }
    return data;
  }

  const prepared = await prepareUploadsForFinalize(
    {
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      uploadIds: input.uploadIds,
    },
    deps,
  );

  const { data, error } = await callPublicRpc(
    input.authedClient,
    "finalize_operator_attachment_message",
    {
      p_workspace_id: input.workspaceId,
      p_conversation_id: input.conversationId,
      p_batch_id: input.batchId,
      p_upload_ids: input.uploadIds,
      p_body: input.body ?? "",
      p_client_message_id: input.clientMessageId,
      p_attachments: prepared.attachmentRows as Json,
    },
  );

  if (error) {
    await cleanupFailedObjects(prepared.storageKeys, deps);
    throw error;
  }

  return data;
}

async function prepareUploadsForFinalize(
  input: {
    workspaceId: string;
    batchId: string;
    uploadIds: string[];
  },
  deps?: AttachmentServiceDeps,
): Promise<{
  attachmentRows: Json[];
  storageKeys: string[];
  views: MessageAttachmentView[];
}> {
  const storage = getStorage(deps);
  const antivirus = getAntivirus(deps);
  const supabase = createServiceClient();

  const { data: rows, error } = await supabase
    .from("attachment_uploads")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("batch_id", input.batchId)
    .in("id", input.uploadIds)
    .order("sort_order", { ascending: true });

  if (error) {
    throw error;
  }

  if (rows.length !== input.uploadIds.length) {
    throw new AttachmentValidationError(
      "INVALID_UPLOAD",
      "Upload intents not found",
    );
  }

  const attachmentRows: Json[] = [];
  const views: MessageAttachmentView[] = [];
  const storageKeys: string[] = [];

  for (const row of rows) {
    if (row.status === "confirmed") {
      // Confirmed uploads are already linked to a durable message. Never
      // re-validate or delete their objects from a subsequent complete call.
      throw new AttachmentValidationError(
        "ALREADY_CONFIRMED",
        "Upload already confirmed",
      );
    }

    if (
      row.status === "cancelled" ||
      row.status === "expired" ||
      row.status === "failed"
    ) {
      throw new AttachmentValidationError(
        "INVALID_UPLOAD",
        "Upload is not active",
      );
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AttachmentValidationError("EXPIRED", "Upload intent expired");
    }

    const head = await storage.headObject(row.storage_key);
    if (!head || head.sizeBytes <= 0) {
      // Some storage backends omit size on list — try downloading magic window.
      try {
        await storage.downloadRange(row.storage_key, 0, 64);
      } catch {
        throw new AttachmentValidationError(
          "UPLOAD_MISSING",
          "Uploaded object not found",
        );
      }
    }

    // Skip size check when storage omits size (0). Soften mismatch: reject only
    // when reported size differs by more than 1% or more than 1024 bytes absolute.
    if (head && head.sizeBytes > 0) {
      const declared = row.size_bytes;
      const delta = Math.abs(head.sizeBytes - declared);
      const tolerance = Math.max(declared * 0.01, 1024);
      if (delta > tolerance) {
        throw new AttachmentValidationError(
          "SIZE_MISMATCH",
          "Uploaded size does not match declared size",
        );
      }
    }

    const magic = await storage.downloadRange(row.storage_key, 0, 4100);
    const magicCheck = validateMagicBytesAgainstDeclared({
      bytes: magic,
      declaredMime: row.mime_type,
      filename: row.filename,
    });

    if (!magicCheck.ok) {
      await storage.deleteObject(row.storage_key).catch(() => undefined);
      throw new AttachmentValidationError(
        magicCheck.error.code,
        magicCheck.error.message,
      );
    }

    const scan = await antivirus.scan({
      workspaceId: input.workspaceId,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      filename: row.filename,
    });

    if (!isAntivirusAllowlisted(scan)) {
      await storage.deleteObject(row.storage_key).catch(() => undefined);
      throw new AttachmentValidationError(
        "INFECTED",
        "File failed security scanning",
      );
    }

    storageKeys.push(row.storage_key);

    const view: MessageAttachmentView = {
      id: row.attachment_id,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      kind: row.kind,
      width: row.width,
      height: row.height,
      duration_ms: null,
      sort_order: row.sort_order,
      has_thumbnail: row.kind === "image",
    };
    views.push(view);

    attachmentRows.push({
      id: row.attachment_id,
      storage_key: row.storage_key,
      thumbnail_storage_key: null,
      mime_type: row.mime_type,
      filename: row.filename,
      size_bytes: row.size_bytes,
      kind: row.kind,
      width: row.width,
      height: row.height,
      duration_ms: null,
      scan_status: scan.status === "clean" ? "clean" : "skipped",
      sort_order: row.sort_order,
      metadata_json: {
        antivirus: {
          status: scan.status,
          engine: scan.engine,
          scannedAt: scan.scannedAt,
          detail: scan.detail ?? null,
        },
      },
    });
  }

  const { error: markError } = await supabase.rpc(
    "mark_attachment_uploads_uploaded",
    {
      p_workspace_id: input.workspaceId,
      p_batch_id: input.batchId,
      p_upload_ids: input.uploadIds,
    },
  );

  if (markError) {
    throw markError;
  }

  return { attachmentRows, storageKeys, views };
}

async function cleanupFailedObjects(
  keys: string[],
  deps?: AttachmentServiceDeps,
): Promise<void> {
  if (keys.length === 0) {
    return;
  }
  await getStorage(deps)
    .deleteObjects(keys)
    .catch(() => undefined);
}

export async function cancelUploads(input: {
  workspaceId: string;
  batchId: string;
  uploadIds?: string[];
  /** Required for visitor cancel — scopes deletion to the owning session. */
  sessionToken?: string;
  /** Required for operator cancel — scopes deletion to the owning member. */
  memberId?: string;
}): Promise<number> {
  if (!input.sessionToken && !input.memberId) {
    throw new AttachmentValidationError(
      "INVALID_UPLOAD",
      "Cancel requires actor scope",
    );
  }

  const supabase = createServiceClient();
  let visitorSessionId: string | null = null;
  if (input.sessionToken) {
    visitorSessionId = await resolveVisitorSessionId(
      input.workspaceId,
      input.sessionToken,
    );
  }

  let query = supabase
    .from("attachment_uploads")
    .select("storage_key")
    .eq("workspace_id", input.workspaceId)
    .eq("batch_id", input.batchId)
    .in("status", ["pending", "uploaded"]);

  if (visitorSessionId) {
    query = query
      .eq("actor_role", "visitor")
      .eq("visitor_session_id", visitorSessionId);
  } else if (input.memberId) {
    query = query
      .eq("actor_role", "operator")
      .eq("agent_member_id", input.memberId);
  }

  if (input.uploadIds && input.uploadIds.length > 0) {
    query = query.in("id", input.uploadIds);
  }

  const { data: rows } = await query;

  const { data, error } = await supabase.rpc("cancel_attachment_uploads", {
    p_workspace_id: input.workspaceId,
    p_batch_id: input.batchId,
    p_upload_ids: input.uploadIds ?? undefined,
    p_visitor_session_id: visitorSessionId ?? undefined,
    p_agent_member_id: input.memberId ?? undefined,
  });

  if (error) {
    throw error;
  }

  const keys = (rows ?? []).map((row) => row.storage_key);
  if (keys.length > 0) {
    await createSupabaseObjectStorage()
      .deleteObjects(keys)
      .catch(() => undefined);
  }

  return typeof data === "number" ? data : 0;
}

export async function createAttachmentDownloadUrl(input: {
  workspaceId: string;
  attachmentId: string;
  variant?: "full" | "thumbnail";
}): Promise<{
  url: string;
  expiresAt: string;
  filename: string;
  mimeType: string;
  contentDisposition: string;
}> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("message_attachments")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.attachmentId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("NOT_FOUND");
  }

  const disposition = contentDispositionAttachment(data.filename);

  if (input.variant === "thumbnail" && data.kind === "image") {
    const signed = await createSignedImageThumbnailUrl({
      path: data.storage_key,
      expiresInSeconds: ATTACHMENT_LIMITS.signedDownloadTtlSeconds,
    });
    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      filename: data.filename,
      mimeType: "image/webp",
      contentDisposition: disposition,
    };
  }

  const signed = await createSupabaseObjectStorage().createSignedDownloadUrl({
    path: data.storage_key,
    expiresInSeconds: ATTACHMENT_LIMITS.signedDownloadTtlSeconds,
    downloadFilename: data.filename,
  });

  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    filename: data.filename,
    mimeType: data.mime_type,
    contentDisposition: disposition,
  };
}

export function buildUploadStartedEvent(input: {
  actorRole: "visitor" | "operator";
  actorKey: string;
  batchId: string;
  conversationId: string;
  clientMessageId?: string | null;
  uploadIds: string[];
  filenames: string[];
  kinds: Array<"image" | "document">;
}) {
  return createUploadBroadcastPayload({
    actorRole: input.actorRole,
    actorKey: input.actorKey,
    state: "started",
    batchId: input.batchId,
    conversationId: input.conversationId,
    clientMessageId: input.clientMessageId ?? null,
    uploadIds: input.uploadIds,
    filenames: input.filenames,
    kinds: input.kinds,
  });
}

export class AttachmentValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AttachmentValidationError";
    this.code = code;
  }
}
