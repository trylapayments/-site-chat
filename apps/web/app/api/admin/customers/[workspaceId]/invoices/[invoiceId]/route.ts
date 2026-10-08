import { z } from "zod";
import { requirePlatformAdministrator } from "@/lib/platform-admin/guard";
import {
  chargebeeCustomer,
  downloadChargebeeInvoice,
} from "@/lib/billing/chargebee";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; invoiceId: string }> },
) {
  const { role } = await requirePlatformAdministrator();
  if (!["owner", "finance"].includes(role))
    return new Response("Not found", { status: 404 });
  const parsed = z
    .object({
      workspaceId: z.string().uuid(),
      invoiceId: z.string().min(1).max(100),
    })
    .safeParse(await params);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const { workspaceId, invoiceId } = parsed.data;
  try {
    const customer = await chargebeeCustomer(workspaceId);
    if (!customer) return new Response("Not found", { status: 404 });
    const invoice = await downloadChargebeeInvoice(
      workspaceId,
      customer,
      invoiceId,
    );
    return new Response(invoice.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Invoice could not be downloaded. Please try again.", {
      status: 502,
    });
  }
}
