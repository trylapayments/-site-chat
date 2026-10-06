"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { chargebeeRequest, loadChargebeeBilling } from "./chargebee";
import { sendSubscriptionEmailForChange } from "./subscription-email";
import { retrieveMillSubscription } from "./subscriptions";
import { BillingValidationError } from "./stripe";
const requestSchema = z.object({
  slug: z.string().min(1).max(200),
  invoiceId: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
  amount: z.number().int().positive(),
  version: z.number().int().positive(),
});
export async function retryInvoicePayment(input: unknown) {
  try {
    const data = requestSchema.parse(input);
    const { workspace } = await requireInboxWorkspace(data.slug);
    if (!["owner", "admin"].includes(workspace.role))
      throw new Error("Billing access denied");
    const invoice = z
      .object({
        invoice: z.object({
          id: z.string(),
          customer_id: z.string(),
          status: z.string(),
          amount_due: z.number(),
          resource_version: z.number(),
        }),
      })
      .parse(await chargebeeRequest(`invoices/${data.invoiceId}`)).invoice;
    if (invoice.customer_id !== `mill_${workspace.workspace_id}`)
      throw new Error("Invoice ownership mismatch");
    if (
      !["payment_due", "not_paid"].includes(invoice.status) ||
      invoice.amount_due !== data.amount ||
      invoice.resource_version !== data.version
    )
      throw new BillingValidationError(
        "This invoice changed. Refresh Billing before confirming another payment.",
      );
    const customer = z
      .object({
        customer: z.object({ primary_payment_source_id: z.string().min(1) }),
      })
      .parse(
        await chargebeeRequest(`customers/${invoice.customer_id}`),
      ).customer;
    const result = z
      .object({
        invoice: z
          .object({ status: z.string(), amount_due: z.number() })
          .passthrough(),
      })
      .parse(
        await chargebeeRequest(
          `invoices/${data.invoiceId}/collect_payment`,
          new URLSearchParams({
            payment_source_id: customer.primary_payment_source_id,
          }),
          `mill-recover-${data.invoiceId}-${String(data.version)}`,
        ),
      );
    await loadChargebeeBilling(workspace.workspace_id);
    if (result.invoice.status === "paid") {
      const subscription = await retrieveMillSubscription(
        workspace.workspace_id,
      );
      if (subscription) {
        try {
          await sendSubscriptionEmailForChange(
            subscription,
            "payment_succeeded",
            result.invoice,
          );
        } catch {
          console.error("[Mill billing] recovery email requires retry");
        }
      }
    }
    revalidatePath(`/app/${data.slug}`, "layout");
    return {
      success: result.invoice.status === "paid",
      message:
        result.invoice.status === "paid"
          ? "Payment received. Your billing records have been refreshed."
          : "The payment could not be completed. Check your card or contact your bank, then try again.",
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof BillingValidationError
          ? error.message
          : "Payment could not be completed. Refresh Billing to check the invoice before trying again.",
    };
  }
}
