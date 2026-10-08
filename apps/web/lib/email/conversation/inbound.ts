import { createHmac, timingSafeEqual } from "node:crypto";

/** Svix authenticates the exact raw bytes, not a reserialized JSON payload. */
export function verifyInboundSignature(raw: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300 || !secret.startsWith("whsec_")) return false;
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
  return signatures.split(/\s+/).some((signature) => {
    const [version, encoded] = signature.split(",");
    if (version !== "v1" || !encoded) return false;
    const candidate = Buffer.from(encoded, "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function mailboxAddress(value: string): string | null {
  const address = (value.match(/<([^<>]+)>\s*$/)?.[1] ?? value).trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) ? address : null;
}

export function replyToken(addresses: string[], domain: string): string | null {
  const tokens = addresses.flatMap((value) => {
    const address = mailboxAddress(value);
    if (!address) return [];
    const [local, host] = address.split("@");
    if (host !== domain.toLowerCase()) return [];
    const match = local?.match(/^(?:reply\+)?([a-f0-9]{64})$/);
    return match?.[1] ? [match[1]] : [];
  });
  const unique = [...new Set(tokens)];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

/** Preserve plain text; strip only recognizable quoted reply boundaries. */
export function incomingReplyText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const end = lines.findIndex((line) => /^On .{1,300}wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()));
  const visible = end < 0 ? lines : lines.slice(0, end);
  return visible.filter((line) => !/^\s*>/.test(line)).join("\n").trim();
}

export function isAutomatedEmail(headers: Record<string, string>): boolean {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]));
  return (normalized["auto-submitted"] !== undefined && normalized["auto-submitted"] !== "no") ||
    /^(bulk|list|junk)$/.test(normalized.precedence ?? "") || Boolean(normalized["list-id"]);
}

/** HTML is converted to plain text only; it is never rendered in the portal. */
export function htmlReplyText(html: string): string {
  return incomingReplyText(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity] ?? "")
    .replace(/&#(\d{1,7});/g, (_, code: string) => { const n = Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; }));
}
