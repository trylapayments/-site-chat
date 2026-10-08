import { z } from "zod";
import { verifyEmbedContext, corsOriginFromEmbed } from "@/lib/widget/context";
import { getEmbedTokenFromRequest } from "@/lib/widget/constants";
import {
  requestOriginMatchesEmbed,
  getRequestOrigin,
  getClientIp,
} from "@/lib/widget/origin";
import { getBearerToken, widgetOptionsResponse } from "@/lib/widget/responses";
import { consumeWidgetRateLimit } from "@/lib/widget/service";
import { hashSessionRateLimitKey } from "@/lib/widget/rate-limit";
import { visitorConversationContext, endVisitorConversation } from "@/lib/conversation-wrapup/context";
import { sendConversationTranscript } from "@/lib/conversation-wrapup/transcript";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("end"), conversationId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("rating"),
      conversationId: z.string().uuid(),
      score: z.number().int().min(1).max(5),
      comment: z.string().trim().max(1000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("transcript"),
      conversationId: z.string().uuid(),
      requestId: z.string().uuid(),
      email: z.string().trim().toLowerCase().email().max(254),
    })
    .strict(),
]);
function respond(data: unknown, status: number, origin?: string | null) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
    },
  });
}
export async function POST(request: Request) {
  const token = getEmbedTokenFromRequest(request);
  const session = getBearerToken(request);
  const embed = token ? await verifyEmbedContext(token) : null;
  if (
    !embed ||
    !session ||
    !requestOriginMatchesEmbed(request, embed.parentOrigin)
  )
    return respond({ error: { message: "Session invalid or expired" } }, 401);
  const origin = corsOriginFromEmbed(embed.parentOrigin);
  if (!request.headers.get("content-type")?.includes("application/json"))
    return respond({ error: { message: "Invalid request." } }, 400, origin);
  if (
    !(await consumeWidgetRateLimit(
      `wrapup:${hashSessionRateLimitKey(session)}`,
      60,
      10,
    ))
  )
    return respond(
      { error: { message: "Too many requests. Please try again shortly." } },
      429,
      origin,
    );
  try {
    const input = inputSchema.parse(await request.json());
    const context = await visitorConversationContext(
      embed.workspaceId,
      session,
    );
    if (context.conversationId !== input.conversationId)
      return respond(
        {
          error: {
            message:
              "This conversation is no longer current. Please reload the chat.",
          },
        },
        409,
        origin,
      );
    if (input.action === "end") {
      await endVisitorConversation(embed.workspaceId,session,input.conversationId);
      return respond({ data: { ended: true } }, 200, origin);
    }
    const setup = await fetchChatSetup(embed.workspaceId, embed.parentOrigin);
    if (input.action === "rating") {
      const { data, error } = await createServiceClient().rpc(
        "widget_rate_conversation",
        {
          p_workspace_id: embed.workspaceId,
          p_session_token: session,
          p_conversation_id: input.conversationId,
          p_score: input.score,
          p_comment: input.comment,
        },
      );
      if (error)
        throw new Error("Rating is unavailable. Please reload the chat.");
      return respond({ data }, 200, origin);
    }
    if (!setup.config.transcriptEnabled)
      throw new Error("Transcript requests are disabled.");
    const ip = getClientIp(request) ?? "unknown";
    if (
      !(await consumeWidgetRateLimit(
        `transcript-ip:${hashSessionRateLimitKey(ip)}`,
        3600,
        10,
      ))
    )
      return respond(
        {
          error: {
            message: "Too many transcript requests. Try again in an hour.",
          },
        },
        429,
        origin,
      );
    await sendConversationTranscript({
      workspaceId: embed.workspaceId,
      ...input,
    });
    return respond({ data: { sent: true } }, 200, origin);
  } catch (error) {
    return respond(
      {
        error: {
          message:
            error instanceof z.ZodError
              ? "Check the form and try again."
              : error instanceof Error
                ? error.message
                : "Unable to complete this request.",
        },
      },
      400,
      origin,
    );
  }
}
export function OPTIONS(request: Request) {
  return (
    widgetOptionsResponse(request, getRequestOrigin(request)) ??
    new Response(null, { status: 204 })
  );
}
