import type { MessageAttachmentViewModel } from "@site-chat/shared";
import { useEffect, useState } from "react";

import type { WidgetApiClient } from "../api/client";
import { formatWidgetMessage, type WidgetMessages } from "../i18n";
import { documentIconLabel, formatFileSize } from "./upload-file";

export function MessageAttachments({
  attachments,
  isVisitor,
  api,
  embedToken,
  sessionToken,
  copy,
}: {
  attachments: MessageAttachmentViewModel[];
  isVisitor: boolean;
  api: WidgetApiClient;
  embedToken: string;
  sessionToken: string;
  copy: WidgetMessages;
}) {
  if (attachments.length === 0) {
    return null;
  }

  const ordered = [...attachments].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        marginTop: "0.5rem",
      }}
    >
      {ordered.map((attachment) =>
        attachment.kind === "image" ? (
          <ImageAttachment
            key={attachment.id}
            attachment={attachment}
            api={api}
            embedToken={embedToken}
            sessionToken={sessionToken}
            copy={copy}
            isVisitor={isVisitor}
          />
        ) : (
          <DocumentAttachment
            key={attachment.id}
            attachment={attachment}
            api={api}
            embedToken={embedToken}
            sessionToken={sessionToken}
            copy={copy}
            isVisitor={isVisitor}
          />
        ),
      )}
    </div>
  );
}

function ImageAttachment({
  attachment,
  api,
  embedToken,
  sessionToken,
  copy,
  isVisitor,
}: {
  attachment: MessageAttachmentViewModel;
  api: WidgetApiClient;
  embedToken: string;
  sessionToken: string;
  copy: WidgetMessages;
  isVisitor: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getAttachmentDownloadUrl({
        embedToken,
        sessionToken,
        attachmentId: attachment.id,
        variant: "thumbnail",
      })
      .then((result) => {
        if (!cancelled) {
          setSrc(result.url);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, attachment.id, embedToken, sessionToken]);

  const label = formatWidgetMessage(copy.imagePreviewLabel, {
    filename: attachment.filename,
  });

  return (
    <>
      <button
        type="button"
        data-testid="attachment-image"
        aria-label={formatWidgetMessage(copy.imageEnlargeLabel, {
          filename: attachment.filename,
        })}
        onClick={() => {
          setLightbox(true);
        }}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: "0.5rem",
          overflow: "hidden",
          maxWidth: "100%",
        }}
      >
        {src ? (
          <img
            src={src}
            alt={label}
            loading="lazy"
            decoding="async"
            width={attachment.width ?? undefined}
            height={attachment.height ?? undefined}
            onLoad={() => {
              setLoaded(true);
            }}
            style={{
              display: "block",
              maxWidth: "100%",
              height: "auto",
              aspectRatio:
                attachment.width && attachment.height
                  ? `${String(attachment.width)} / ${String(attachment.height)}`
                  : undefined,
              opacity: loaded ? 1 : 0.4,
              transition: "opacity 200ms ease",
              background: isVisitor ? "rgba(255,255,255,0.15)" : "#e5e7eb",
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: "12rem",
              height: "8rem",
              background: isVisitor ? "rgba(255,255,255,0.15)" : "#e5e7eb",
              borderRadius: "0.5rem",
            }}
          />
        )}
      </button>
      {lightbox ? (
        <ImageLightbox
          attachment={attachment}
          api={api}
          embedToken={embedToken}
          sessionToken={sessionToken}
          copy={copy}
          onClose={() => {
            setLightbox(false);
          }}
        />
      ) : null}
    </>
  );
}

function ImageLightbox({
  attachment,
  api,
  embedToken,
  sessionToken,
  copy,
  onClose,
}: {
  attachment: MessageAttachmentViewModel;
  api: WidgetApiClient;
  embedToken: string;
  sessionToken: string;
  copy: WidgetMessages;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getAttachmentDownloadUrl({
        embedToken,
        sessionToken,
        attachmentId: attachment.id,
        variant: "full",
      })
      .then((result) => {
        if (!cancelled) {
          setSrc(result.url);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, attachment.id, embedToken, sessionToken]);

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
      aria-label={formatWidgetMessage(copy.imagePreviewLabel, {
        filename: attachment.filename,
      })}
      data-testid="attachment-lightbox"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "1rem",
      }}
    >
      {src ? (
        <img
          src={src}
          alt={attachment.filename}
          onClick={(event) => {
            event.stopPropagation();
          }}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      ) : null}
    </div>
  );
}

function DocumentAttachment({
  attachment,
  api,
  embedToken,
  sessionToken,
  copy,
  isVisitor,
}: {
  attachment: MessageAttachmentViewModel;
  api: WidgetApiClient;
  embedToken: string;
  sessionToken: string;
  copy: WidgetMessages;
  isVisitor: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const result = await api.getAttachmentDownloadUrl({
        embedToken,
        sessionToken,
        attachmentId: attachment.id,
        variant: "full",
      });
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = attachment.filename;
      anchor.rel = "noopener noreferrer";
      anchor.target = "_blank";
      anchor.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="attachment-document"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem",
        borderRadius: "0.5rem",
        background: isVisitor ? "rgba(255,255,255,0.12)" : "#f3f4f6",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: "0.65rem",
          fontWeight: 700,
          padding: "0.25rem 0.35rem",
          borderRadius: "0.25rem",
          background: isVisitor ? "rgba(255,255,255,0.2)" : "#e5e7eb",
        }}
      >
        {documentIconLabel(attachment.mimeType)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "0.8rem",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={attachment.filename}
        >
          {attachment.filename}
        </div>
        <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>
          {formatFileSize(attachment.sizeBytes)}
        </div>
      </div>
      <button
        type="button"
        data-testid="attachment-download"
        disabled={busy}
        aria-label={formatWidgetMessage(copy.downloadLabel, {
          filename: attachment.filename,
        })}
        onClick={() => {
          void onDownload();
        }}
        style={{
          border: "none",
          background: "transparent",
          color: "inherit",
          textDecoration: "underline",
          cursor: "pointer",
          fontSize: "0.75rem",
        }}
      >
        {busy ? "…" : "↓"}
      </button>
    </div>
  );
}
