"use server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdministrator } from "./guard";
import { createServiceClient } from "@/lib/supabase/service";
import {
  chargebeeRequest,
  loadChargebeeBilling,
} from "@/lib/billing/chargebee";
import { BillingValidationError } from "@/lib/billing/stripe";
const request = z.object({
  workspaceId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});
const invoiceSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  status: z.string(),
  amount_due: z.number(),
  currency_code: z.string(),
  resource_version: z.number(),
  due_date: z.number().optional(),
  date: z.number(),
  linked_payments: z.array(z.object({ txn_status: z.string() })).optional(),
});
const debtSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  version: z.number(),
});
function signature(payload: string) {
  const key = process.env.CHARGEBEE_API_KEY;
  if (!key) throw new Error("Billing unavailable");
  return createHmac("sha256", key)
    .update(`mill-debt-writeoff:${payload}`)
    .digest("hex");
}
async function debts(workspaceId: string) {
  const customer = `mill_${workspaceId}`;
  const items: z.infer<typeof debtSchema>[] = [];
  let offset: string | undefined;
  do {
    const query = new URLSearchParams({
      "customer_id[is]": customer,
      limit: "100",
      ...(offset ? { offset } : {}),
    });
    const page = z
      .object({
        list: z.array(z.object({ invoice: invoiceSchema })),
        next_offset: z.string().optional(),
      })
      .parse(await chargebeeRequest(`invoices?${query}`));
    for (const { invoice } of page.list) {
      if (invoice.customer_id !== customer)
        throw new Error("Invoice ownership mismatch");
      if (
        !["payment_due", "not_paid", "posted"].includes(invoice.status) ||
        invoice.amount_due <= 0 ||
        (invoice.due_date ?? invoice.date) * 1000 > Date.now()
      )
        continue;
      if (invoice.linked_payments?.some((p) => p.txn_status === "in_progress"))
        throw new BillingValidationError(
          "A payment is still processing. Wait for its result before writing off debt.",
        );
      items.push({
        id: invoice.id,
        amount: invoice.amount_due,
        currency: invoice.currency_code,
        version: invoice.resource_version,
      });
    }
    offset = page.next_offset;
  } while (offset);
  return items.sort((a, b) => a.id.localeCompare(b.id));
}
export async function adminDebtEstimate(input: unknown) {
  try {
    const { user, role } = await requirePlatformAdministrator();
    if (!["owner", "finance"].includes(role))
      throw new Error("Billing access denied");
    const data = request.parse(input);
    const invoices = await debts(data.workspaceId);
    if (!invoices.length)
      throw new BillingValidationError(
        "There is no outstanding debt to write off.",
      );
    const payload = Buffer.from(
      JSON.stringify({
        data,
        invoices,
        actor: user.id,
        expires: Date.now() + 300000,
      }),
    ).toString("base64url");
    return {
      success: true as const,
      invoices,
      token: `${payload}.${signature(payload)}`,
    };
  } catch (error) {
    return {
      success: false as const,
      message:
        error instanceof BillingValidationError
          ? error.message
          : "The outstanding balance could not be loaded.",
    };
  }
}
export async function adminDebtConfirm(token: string) {
  try {
    const { user, role } = await requirePlatformAdministrator();
    if (!["owner", "finance"].includes(role))
      throw new Error("Billing access denied");
    if (typeof token !== "string" || token.length > 100000)
      throw new Error("Invalid review");
    const [payload, signed, ...extra] = token.split(".");
    if (!payload || !signed || extra.length) throw new Error("Invalid review");
    const expected = signature(payload);
    if (
      signed.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signed), Buffer.from(expected))
    )
      throw new Error("Invalid review");
    const value = z
      .object({
        data: request,
        invoices: z.array(debtSchema),
        actor: z.string(),
        expires: z.number(),
      })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (value.actor !== user.id || value.expires < Date.now())
      throw new BillingValidationError(
        "This review expired. Review the balance again.",
      );
    if (
      JSON.stringify(await debts(value.data.workspaceId)) !==
      JSON.stringify(value.invoices)
    )
      throw new BillingValidationError(
        "The outstanding balance changed. Review it again before confirming.",
      );
    const service = createServiceClient();
    const audit = await service
      .from("platform_audit_log")
      .insert({
        actor_id: user.id,
        workspace_id: value.data.workspaceId,
        action: "billing_debt_writeoff_requested",
        reason: value.data.reason,
        before_json: { invoices: value.invoices },
        after_json: { next_renewal_unchanged: true },
      })
      .select("id")
      .single();
    if (audit.error) throw new Error("Audit unavailable");
    for (const invoice of value.invoices) {
      const result = z
        .object({
          invoice: z.object({
            id: z.string(),
            status: z.string(),
            amount_due: z.number(),
            write_off_amount: z.number().optional(),
          }),
        })
        .parse(
          await chargebeeRequest(
            `invoices/${encodeURIComponent(invoice.id)}/write_off`,
            new URLSearchParams({ comment: value.data.reason }),
            `mill-writeoff-${invoice.id}-${String(invoice.version)}`,
          ),
        );
      if (
        result.invoice.id !== invoice.id ||
        result.invoice.status !== "paid" ||
        result.invoice.amount_due !== 0
      )
        throw new Error("Write-off pending");
    }
    await loadChargebeeBilling(value.data.workspaceId);
    const completed = await service
      .from("platform_audit_log")
      .insert({
        actor_id: user.id,
        workspace_id: value.data.workspaceId,
        action: "billing_debt_writeoff_completed",
        reason: value.data.reason,
        before_json: { request_id: audit.data.id },
        after_json: { invoices: value.invoices, next_renewal_unchanged: true },
      });
    if (completed.error) throw new Error("Audit confirmation unavailable");
    revalidatePath(`/admin/customers/${value.data.workspaceId}`);
    revalidatePath("/admin/billing");
    revalidatePath("/app", "layout");
    return {
      success: true,
      message:
        "Debt written off. Billing-related restrictions are cleared. The next renewal date and charge are unchanged; separate administrative restrictions remain in effect.",
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof BillingValidationError
          ? error.message
          : "The write-off could not be confirmed. Refresh Billing to check each invoice before trying again.",
    };
  }
}
