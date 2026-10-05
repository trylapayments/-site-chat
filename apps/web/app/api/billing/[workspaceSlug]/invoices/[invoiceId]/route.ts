import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { workspaceCustomer, downloadInvoice } from "@/lib/billing/stripe";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceSlug: string; invoiceId: string }> },
) {
  const { workspaceSlug, invoiceId } = await params;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  if (!["owner", "admin"].includes(workspace.role))
    return new Response("Not found", { status: 404 });
  try {
    const customer = await workspaceCustomer(workspace.workspace_id);
    if (!customer) return new Response("Not found", { status: 404 });
    const invoice = await downloadInvoice(customer, invoiceId);
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
