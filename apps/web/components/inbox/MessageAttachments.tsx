"use client";

import type { MessageAttachmentViewModel } from "@site-chat/shared";
import { useEffect, useState } from "react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchDownloadUrl(
  workspaceId: string,
  attachmentId: string,
  variant: "full" | "thumbnail",
): Promise<string> {
  const url = new URL(
    "/api/v1/inbox/attachments/download",
    window.location.origin,
  );
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("attachmentId", attachmentId);
  url.searchParams.set("variant", variant);
  const response = await fetch(url.toString(), { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("download failed");
  }
  const json = (await response.json()) as { data: { url: string } };
  return json.data.url;
}

export function OperatorMessageAttachments({
  workspaceId,
  attachments,
}: {
  workspaceId: string;
  attachments: MessageAttachmentViewModel[];
}) {
  if (!attachments.length) {
    return null;
  }

  const ordered = [...attachments].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div
      className="mt-2 flex flex-col gap-2"
      data-testid="operator-attachments"
    >
      {ordered.map((attachment) =>
        attachment.kind === "image" ? (
          <OperatorImageAttachment
            key={attachment.id}
            workspaceId={workspaceId}
            attachment={attachment}
          />
        ) : (
          <OperatorDocumentAttachment
            key={attachment.id}
            workspaceId={workspaceId}
            attachment={attachment}
          />
        ),
      )}
    </div>
  );
}

function OperatorImageAttachment({
  workspaceId,
  attachment,
}: {
  workspaceId: string;
  attachment: MessageAttachmentViewModel;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchDownloadUrl(workspaceId, attachment.id, "thumbnail")
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attachment.id]);

  return (
    <>
      <button
        type="button"
        className="block max-w-xs overflow-hidden rounded-md border bg-background p-0"
        data-testid="operator-attachment-image"
        aria-label={`Enlarge image ${attachment.filename}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={attachment.filename}
            loading="lazy"
            className="h-auto max-h-64 w-full object-contain"
            width={attachment.width ?? undefined}
            height={attachment.height ?? undefined}
          />
        ) : (
          <div className="bg-muted h-32 w-48 animate-pulse" />
        )}
      </button>
      {open ? (
        <OperatorLightbox
          workspaceId={workspaceId}
          attachment={attachment}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function OperatorLightbox({
  workspaceId,
  attachment,
  onClose,
}: {
  workspaceId: string;
  attachment: MessageAttachmentViewModel;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDownloadUrl(workspaceId, attachment.id, "full")
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attachment.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="operator-attachment-lightbox"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={attachment.filename}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      ) : null}
    </div>
  );
}

function OperatorDocumentAttachment({
  workspaceId,
  attachment,
}: {
  workspaceId: string;
  attachment: MessageAttachmentViewModel;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="bg-background flex items-center gap-3 rounded-md border px-3 py-2"
      data-testid="operator-attachment-document"
    >
      <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
        file
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={attachment.filename}>
          {attachment.filename}
        </p>
        <p className="text-muted-foreground text-xs">
          {formatSize(attachment.sizeBytes)}
        </p>
      </div>
      <button
        type="button"
        className="text-primary text-xs font-medium underline"
        data-testid="operator-attachment-download"
        aria-label={`Download ${attachment.filename}`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void fetchDownloadUrl(workspaceId, attachment.id, "full")
            .then((url) => {
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = attachment.filename;
              anchor.target = "_blank";
              anchor.rel = "noopener noreferrer";
              anchor.click();
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        Download
      </button>
    </div>
  );
}
