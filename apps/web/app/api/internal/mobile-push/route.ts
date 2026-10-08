import { createHash, timingSafeEqual } from "node:crypto";
import { processAllMobilePush } from "@/lib/mobile/push";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.MOBILE_PUSH_CRON_SECRET;
  if (!secret || secret.length < 32)
    return Response.json({ error: "Worker not configured" }, { status: 503 });
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const actual = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest();
  if (!timingSafeEqual(expected, actual))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await processAllMobilePush(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Push processing failed" }, { status: 503 });
  }
}
