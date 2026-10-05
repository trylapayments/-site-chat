import { InvoiceDownload } from "@/components/settings/InvoiceDownload";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CreditCard,
  ReceiptText,
  Building2,
  CalendarDays,
  ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { BillingPaymentMethods } from "@/components/settings/BillingPaymentMethods";
import { BillingDetailsEditor } from "@/components/settings/BillingDetailsEditor";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  billingMode,
  loadBilling,
  billingConfigured,
  stripePublishableKey,
  BillingSetupError,
} from "@/lib/billing/stripe";
import { workspaceWidgetStudioEntitlements } from "@/lib/widget-studio/entitlements.server";
import { toAppRoute } from "@/lib/auth/redirect";
import { formatBillingAmount as amount } from "@/lib/billing/format";
export default async function BillingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  if (!["owner", "admin"].includes(workspace.role)) notFound();
  let state: Awaited<ReturnType<typeof loadBilling>> | null = null;
  try {
    state = await loadBilling(workspace.workspace_id);
  } catch (error) {
    if (error instanceof BillingSetupError)
      console.error("[Mill billing]", { stage: error.stage, code: error.code });
    else
      console.error("[Mill billing]", {
        stage: "load",
        code: error instanceof Error ? error.name : "unknown",
      });
  }
  const subscription = state?.subscriptions.find((s) =>
    ["active", "trialing", "past_due", "unpaid", "paused"].includes(s.status),
  );
  const item = subscription?.items.data[0];
  const renewal = subscription?.current_period_end || item?.current_period_end;
  const pilot = workspaceWidgetStudioEntitlements(
    workspace.workspace_id,
  ).features.has("hide_powered_by");
  return (
    <div className="space-y-6" data-testid="billing-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Billing"
          description="Your subscription, payment details and invoice history."
        />
        {billingMode() === "test" ? (
          <span className="rounded-md bg-[#eee7dc] px-3 py-1.5 text-xs text-[#7b6245]">
            Test billing · no real charges
          </span>
        ) : null}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border border-inbox-border bg-white p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="size-4" />
            Current plan
          </div>
          <h2 className="mt-4 text-2xl font-semibold">
            {item && typeof item.price.product === "object"
              ? item.price.product.name
              : subscription
                ? "Mill subscription"
                : !state
                  ? "Unavailable"
                  : pilot
                    ? "Pilot access"
                    : "No active subscription"}
          </h2>
          {subscription ? (
            <>
              <p className="mt-2 text-sm capitalize">
                {subscription.status.replaceAll("_", " ")}
                {item?.price.unit_amount != null
                  ? ` · ${amount(item.price.unit_amount, item.price.currency)} / ${item.price.recurring?.interval ?? "period"}`
                  : ""}
              </p>
              {renewal ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="size-4" />
                  {subscription.cancel_at_period_end
                    ? "Access ends"
                    : "Next renewal"}{" "}
                  {new Date(renewal * 1000).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {pilot
                ? "Your workspace has pilot access to Mill features. No paid subscription has been started."
                : "There is no paid subscription for this workspace yet."}
            </p>
          )}
          {state && !state.connected ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Billing is not connected yet.
            </p>
          ) : null}
          {!state ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Billing could not be loaded. Please refresh to try again.
            </p>
          ) : null}
        </section>
        <section className="rounded-xl border border-inbox-border bg-white p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4 text-muted-foreground" />
            Company details
          </div>
          <p className="mt-4 font-medium">{workspace.name}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Keep your legal name, address and tax details up to date.
          </p>
          <Link
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-brand"
            href={toAppRoute(`/app/${workspaceSlug}/settings/company`)}
          >
            Edit company details
            <ArrowUpRight className="size-4" />
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            Payment methods and invoice details are managed here in Mill.
          </p>
        </section>
      </div>
      <BillingPaymentMethods
        slug={workspaceSlug}
        methods={state?.paymentMethods ?? []}
        defaultMethod={state?.defaultPaymentMethod ?? null}
        publishableKey={stripePublishableKey()}
        enabled={billingConfigured()}
        unavailable={!state}
      />
      <BillingDetailsEditor
        slug={workspaceSlug}
        enabled={billingConfigured()}
        initial={{
          name: state?.customerDetails?.name ?? workspace.name,
          email: state?.customerDetails?.email ?? "",
          line1: state?.customerDetails?.address?.line1 ?? "",
          line2: state?.customerDetails?.address?.line2 ?? "",
          city: state?.customerDetails?.address?.city ?? "",
          state: state?.customerDetails?.address?.state ?? "",
          postal_code: state?.customerDetails?.address?.postal_code ?? "",
          country: state?.customerDetails?.address?.country ?? "",
        }}
      />
      <section className="overflow-hidden rounded-xl border border-inbox-border bg-white">
        <h2 className="flex items-center gap-2 p-6 font-semibold">
          <ReceiptText className="size-4 text-muted-foreground" />
          Invoices
        </h2>
        {state?.invoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-[#f7f6f2] text-xs text-muted-foreground">
                <tr>
                  {["Invoice", "Date", "Amount", "Status", ""].map((h, i) => (
                    <th key={i} className="px-6 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.invoices.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="px-6 py-4">{i.number || "Draft invoice"}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {new Date(i.created * 1000).toLocaleDateString("en-US")}
                    </td>
                    <td className="px-6 py-4">{amount(i.total, i.currency)}</td>
                    <td className="px-6 py-4 capitalize">
                      {i.status || "Draft"}
                    </td>
                    <td className="px-6 py-4">
                      {i.invoice_pdf ? (
                        <InvoiceDownload
                          slug={workspaceSlug}
                          invoiceId={i.id}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.hasMoreInvoices ? (
              <p className="p-6 text-sm text-muted-foreground">
                Showing the latest 100 invoices.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            {state
              ? "No invoices yet. Your invoices will appear here after billing begins."
              : "Invoice history is temporarily unavailable."}
          </p>
        )}
      </section>
    </div>
  );
}
