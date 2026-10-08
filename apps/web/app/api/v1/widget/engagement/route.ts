import { dispatchMobilePush } from "@/lib/mobile/dispatch";
import { dispatchNotificationEmails } from "@/lib/email/dispatch-notifications";

export const maxDuration = 60;

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ipCountryFromRequest,
  ipCityFromRequest,
} from "@/lib/widget/ip-country";
import { publicVisitorConversationContext } from "@/lib/conversation-wrapup/context";
import { validatePreChatSubmission } from "@site-chat/shared";
import { isIP } from "node:net";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
import { verifyEmbedContext, corsOriginFromEmbed } from "@/lib/widget/context";
import { getEmbedTokenFromRequest } from "@/lib/widget/constants";
import {
  requestOriginMatchesEmbed,
  getClientIp,
  getRequestOrigin,
} from "@/lib/widget/origin";
import { getBearerToken, widgetOptionsResponse } from "@/lib/widget/responses";
import { consumeWidgetRateLimit } from "@/lib/widget/service";
import { hashSessionRateLimitKey } from "@/lib/widget/rate-limit";
function response(data: unknown, status = 200, origin?: string | null) {
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
async function authorize(request: Request) {
  const token = getEmbedTokenFromRequest(request);
  const session = getBearerToken(request);
  const embed = token ? await verifyEmbedContext(token) : null;
  if (
    !embed ||
    !session ||
    !requestOriginMatchesEmbed(request, embed.parentOrigin)
  )
    return null;
  const origin = corsOriginFromEmbed(embed.parentOrigin);
  if (
    !(await consumeWidgetRateLimit(
      `engagement:${hashSessionRateLimitKey(session)}`,
      60,
      10,
    ))
  )
    return { limited: true as const, origin };
  return {
    limited: false as const,
    workspaceId: embed.workspaceId,
    session,
    origin,
  };
}
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth)
    return response({ error: { message: "Session invalid or expired" } }, 401);
  if (auth.limited)
    return response(
      { error: { message: "Too many requests" } },
      429,
      auth.origin,
    );
  try {
    const candidate =
      process.env.VERCEL || process.env.NODE_ENV !== "production"
        ? getClientIp(request)
        : null;
    const ip = candidate && isIP(candidate) ? candidate : null;
    const { data, error } = await createServiceClient().rpc(
      "widget_engagement_heartbeat",
      {
        p_workspace_id: auth.workspaceId,
        p_session_token: auth.session,
        p_ip: ip ?? undefined,
      },
    );
    if (error) throw error;
    const country = ipCountryFromRequest(request);
    if (process.env.VERCEL === "1") {
      // Trusted edge location, scoped to the authenticated visitor session.
      const { error: geoError } = await (
        createServiceClient() as unknown as SupabaseClient
      ).rpc("record_widget_ip_location", {
        p_workspace_id: auth.workspaceId,
        p_session_token: auth.session,
        p_country: country,
        p_city: ipCityFromRequest(request),
      });
      if (geoError)
        console.error("Unable to record visitor IP country", geoError.code);
    }
    const settings = await fetchChatSetup(auth.workspaceId, auth.origin);
    const context = await publicVisitorConversationContext(
      auth.workspaceId,
      auth.session,
    );
    return response(
      {
        data: {
          ...(data as Record<string, unknown>),
          ...context,
          hasConversation: context.conversationId !== null,
          setup: settings.config,
          version: settings.version,
        },
      },
      200,
      auth.origin,
    );
  } catch {
    return response(
      { error: { message: "Unable to load chat settings. Please try again." } },
      400,
      auth.origin,
    );
  }
}
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth)
    return response({ error: { message: "Session invalid or expired" } }, 401);
  if (auth.limited)
    return response(
      { error: { message: "Too many requests" } },
      429,
      auth.origin,
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return response(
      { error: { message: "Invalid form submission." } },
      400,
      auth.origin,
    );
  try {
    const input: unknown = await request.json();
    const followUp = z
      .object({
        action: z.literal("reply_email"),
        email: z.string().trim().email().max(254),
      })
      .strict()
      .safeParse(input);
    if (followUp.success) {
      const settings = await fetchChatSetup(auth.workspaceId, auth.origin);
      if (!settings.config.unansweredEmailEnabled)
        return response(
          { error: { message: "Email follow-up is disabled." } },
          403,
          auth.origin,
        );
      const { data, error } = await createServiceClient().rpc(
        "widget_save_reply_email" as never,
        {
          p_workspace_id: auth.workspaceId,
          p_session_token: auth.session,
          p_email: followUp.data.email,
        } as never,
      );
      if (error || data !== true) throw new Error("Unable to save email");
      return response({ data: { saved: true } }, 200, auth.origin);
    }
    const settings = await fetchChatSetup(auth.workspaceId, auth.origin);
    const parsed = validatePreChatSubmission(settings.config, input);
    if (!parsed.success)
      return response(
        {
          error: {
            message: parsed.error.issues[0]?.message ?? "Check the form.",
          },
        },
        400,
        auth.origin,
      );
    const submission = parsed.data;
    const snapshot = {
      name: submission.name,
      email: submission.email,
      phone: submission.phone,
      fields: settings.config.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        value: submission.answers[field.id] ?? null,
      })),
    };
    const { data, error } = await createServiceClient().rpc(
      "widget_submit_pre_chat",
      {
        p_workspace_id: auth.workspaceId,
        p_session_token: auth.session,
        p_request_id: submission.requestId,
        p_snapshot: snapshot,
        p_config_version: settings.version,
      },
    );
    if (error) throw error;
    dispatchNotificationEmails();
    dispatchMobilePush();
    return response({ data }, 200, auth.origin);
  } catch {
    return response(
      {
        error: {
          message: "Unable to submit. Please reload the form and try again.",
        },
      },
      400,
      auth.origin,
    );
  }
}
export function OPTIONS(request: Request) {
  return (
    widgetOptionsResponse(request, getRequestOrigin(request)) ??
    new Response(null, { status: 204 })
  );
}
