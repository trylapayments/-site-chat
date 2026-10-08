import { evaluateWidgetAvailability } from "@site-chat/shared";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
import { z } from "zod";
import { verifyEmbedContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import { widgetJsonError, widgetJsonSuccess } from "@/lib/widget/responses";
import { workspaceOperatorStatus } from "@/lib/operators/availability";
import { consumeWidgetRateLimit } from "@/lib/widget/service";
import { hashBootstrapRateLimitKey } from "@/lib/widget/rate-limit";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const parsed = z
      .object({ embedToken: z.string().max(4096) })
      .strict()
      .safeParse(await request.json());
    if (!parsed.success)
      return widgetJsonError(
        "VALIDATION_ERROR",
        "Invalid request",
        400,
        requestId,
      );
    const context = await verifyEmbedContext(parsed.data.embedToken);
    if (!context)
      return widgetJsonError("FORBIDDEN", "Forbidden", 403, requestId);
    const allowed = await consumeWidgetRateLimit(
      hashBootstrapRateLimitKey(`availability:${parsed.data.embedToken}`),
      60,
      12,
    );
    if (!allowed)
      return widgetJsonError(
        "RATE_LIMITED",
        "Too many requests",
        429,
        requestId,
      );
    const [status, setup] = await Promise.all([
      workspaceOperatorStatus(context.workspaceId),
      fetchChatSetup(context.workspaceId, context.parentOrigin),
    ]);
    const availability = evaluateWidgetAvailability(setup.config, status);
    return widgetJsonSuccess(
      z.object({
        status: z.enum(["available", "away", "offline"]),
        visible: z.boolean(),
      }),
      availability,
      requestId,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return widgetJsonError(
      "INTERNAL_ERROR",
      "Unable to read availability",
      500,
      requestId,
    );
  }
}
