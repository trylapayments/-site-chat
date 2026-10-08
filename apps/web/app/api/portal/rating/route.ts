import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConversationRatingAction } from "@/lib/conversation-wrapup/actions";
export async function GET(request: NextRequest) {
  try {
    const slug = z.string().min(1).max(200).parse(request.nextUrl.searchParams.get("slug"));
    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("conversationId"));
    return NextResponse.json(await getConversationRatingAction(slug, id), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Unable to load rating." }, { status: 400 }); }
}
