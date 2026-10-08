import { type NextRequest, NextResponse } from "next/server";
import { translateInPortal, loadOperatorReplyOriginals } from "@/lib/ai-translation/actions";
export async function POST(request: NextRequest) {
  const started = performance.now();
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  try {
    const body: unknown = await request.json();
    const originals = typeof body === "object" && body !== null && "operation" in body && body.operation === "originals";
    const result = originals && "input" in body ? await loadOperatorReplyOriginals(body.input) : await translateInPortal(body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "Server-Timing": `translation;dur=${String(Math.round(performance.now() - started))}` } });
  } catch { return NextResponse.json({ ok: false, error: "Unable to translate." }, { status: 400 }); }
}
