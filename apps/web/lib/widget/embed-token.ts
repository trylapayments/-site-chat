import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { widgetPublicKeySchema } from "@site-chat/shared";

import { env } from "@/lib/env.server";

const EMBED_TOKEN_TTL_SECONDS = 300;

export type EmbedTokenPayload = {
  widgetPublicKey: string;
  workspaceId: string;
  parentOrigin: string;
  exp: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payloadBase64: string): string {
  return createHmac("sha256", env.WIDGET_EMBED_SECRET)
    .update(payloadBase64)
    .digest("base64url");
}

export function normalizeParentOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (!host) {
      return null;
    }
    if (host === "localhost" || host === "127.0.0.1") {
      return `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`;
    }
    const port =
      url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";
    return `${url.protocol}//${host}${port}`;
  } catch {
    return null;
  }
}

export function createEmbedToken(input: {
  widgetPublicKey: string;
  workspaceId: string;
  parentOrigin: string;
}): { token: string; expiresAt: Date } {
  widgetPublicKeySchema.parse(input.widgetPublicKey);

  const normalizedOrigin = normalizeParentOrigin(input.parentOrigin);
  if (!normalizedOrigin) {
    throw new Error("Invalid parent origin");
  }

  const expiresAt = new Date(Date.now() + EMBED_TOKEN_TTL_SECONDS * 1000);
  const payload: EmbedTokenPayload = {
    widgetPublicKey: input.widgetPublicKey,
    workspaceId: input.workspaceId,
    parentOrigin: normalizedOrigin,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };

  const payloadBase64 = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64);

  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt,
  };
}

export function verifyEmbedToken(token: string): EmbedTokenPayload {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    throw new Error("Invalid embed token format");
  }

  const expectedSignature = signPayload(payloadBase64);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new Error("Invalid embed token signature");
  }

  const payload = JSON.parse(
    decodeBase64Url(payloadBase64),
  ) as EmbedTokenPayload;

  if (
    typeof payload.widgetPublicKey !== "string" ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.parentOrigin !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new Error("Invalid embed token payload");
  }

  if (payload.exp * 1000 <= Date.now()) {
    throw new Error("Embed token expired");
  }

  widgetPublicKeySchema.parse(payload.widgetPublicKey);

  return payload;
}

export function createRequestId(): string {
  return randomUUID();
}

export const EMBED_TOKEN_TTL_MS = EMBED_TOKEN_TTL_SECONDS * 1000;
