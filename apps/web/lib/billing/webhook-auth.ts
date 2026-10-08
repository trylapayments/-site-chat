import { timingSafeEqual } from "node:crypto";
export function validBillingWebhookAuth(
  header: string | null,
  user: string | undefined,
  password: string | undefined,
) {
  if (
    !header ||
    !user ||
    !password ||
    !header.startsWith("Basic ") ||
    header.length > 4096
  )
    return false;
  const expected = Buffer.from(`${user}:${password}`);
  const actual = Buffer.from(header.slice(6), "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
