import { CancelPlan } from "@/components/settings/CancelPlan";
import { AccountTranslationUsage } from "@/components/settings/AccountTranslationUsage";
import { Suspense } from "react";
import { aiCreditBalance, aiCreditHistory } from "@/lib/ai/credits";
import { OverduePayment } from "@/components/settings/OverduePayment";
import { SubscriptionManager } from "@/components/settings/SubscriptionManager";
import { checkoutEnabled } from "@/lib/billing/subscriptions";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { MILL_PLANS, findMillPlan } from "@/lib/billing/plans";
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
  usesChargebee,
} from "@/lib/billing/provider";
import { stripePublishableKey, BillingSetupError } from "@/lib/billing/stripe";
import { chargebeeBrowserConfig } from "@/lib/billing/chargebee";

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
    [
      "active",
      "trialing",
      "non_renewing",
      "past_due",
      "unpaid",
      "paused",
    ].includes(s.status),
  );
  const item = subscription?.items.data[0];
  const renewal = subscription?.current_period_end || item?.current_period_end;
  const scheduledChange =
    state && "scheduledChange" in state ? state.scheduledChange : null;
  const access = await workspaceBillingAccess(workspace.workspace_id);
  // A usage read outage must not block payment recovery or card management.
  const aiUsage = await Promise.all([
    aiCreditBalance(workspace.workspace_id),
    aiCreditHistory(workspace.workspace_id),
  ])
    .then(([balance, history]) => ({ balance, history }))
    .catch(() => null);
  const aiBalance = aiUsage?.balance;
  const accessPlan = access.planId ? findMillPlan(access.planId) : null;
  const pilot = access.source === "pilot";
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
      {access.dunning ? (
        <section
          role="alert"
          className="rounded-xl border border-[#e1d6bf] bg-[#fbf6e9] p-6 text-[#594b32]"
        >
          <h2 className="font-semibold">
            {access.dunning.expired
              ? "Payment is overdue"
              : "Your payment needs attention"}
          </h2>
          <p className="mt-2 text-sm">
            Invoice {access.dunning.invoice.id} ·{" "}
            {amount(
              access.dunning.invoice.amount_due,
              access.dunning.invoice.currency_code,
            )}{" "}
            outstanding.
          </p>
          <p className="mt-2 text-sm">
            {access.source === "payment_overdue"
              ? "Your chat is paused. Pay the outstanding invoice to restore paid access. Your conversations are preserved."
              : access.source === "grace"
                ? `Your chat remains active until ${new Date(access.dunning.deadline).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Update your payment method or pay below to keep it running.`
                : "Your separate Mill access grant remains in effect. This invoice is still outstanding."}
          </p>
          {access.dunning.invoice.next_retry_at ? (
            <p className="mt-2 text-sm">
              Next automatic attempt:{" "}
              {new Date(
                access.dunning.invoice.next_retry_at * 1000,
              ).toLocaleString("en-US", { timeZone: "UTC" })}{" "}
              UTC.
            </p>
          ) : null}
          {access.dunning.invoice.resource_version ? (
            <OverduePayment
              slug={workspaceSlug}
              invoiceId={access.dunning.invoice.id}
              amount={access.dunning.invoice.amount_due}
              currency={access.dunning.invoice.currency_code}
              version={access.dunning.invoice.resource_version}
            />
          ) : null}
        </section>
      ) : null}
      {access.addOnDebts
        .filter((i) => i.id !== access.dunning?.invoice.id)
        .map((i) => (
          <section
            key={i.id}
            role="alert"
            className="rounded-xl border border-[#e1d6bf] bg-[#fbf6e9] p-6 text-[#594b32]"
          >
            <h2 className="font-semibold">
              Additional service payment overdue
            </h2>
            <p className="mt-2 text-sm">
              Invoice {i.id} · {amount(i.amount_due, i.currency_code)}{" "}
              outstanding. Only the unpaid additional services are paused. This
              add-on debt does not pause your base chat.
            </p>
            {i.resource_version ? (
              <OverduePayment
                slug={workspaceSlug}
                invoiceId={i.id}
                amount={i.amount_due}
                currency={i.currency_code}
                version={i.resource_version}
              />
            ) : null}
          </section>
        ))}
      <div className="mill-billing-summary grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-xl border border-inbox-border bg-white p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="size-4" />
            Current plan
          </div>
          <h2 className="mt-4 text-2xl font-semibold">
            {access.source === "complimentary"
              ? `${accessPlan?.name ?? "Mill"} · complimentary`
              : access.source === "trial" && !subscription
                ? "Mill trial"
                : item && typeof item.price.product === "object"
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
              {access.source === "trial"
                ? `Your trial ends on ${new Date(access.expiresAt ?? "").toLocaleDateString("en-US")}. Choose a plan to continue after your trial.`
                : access.source === "complimentary"
                  ? "Your plan is provided by Mill without payment. No subscription is required while this grant is active."
                  : pilot
                    ? "Your workspace has pilot access to Mill features. No paid subscription has been started."
                    : "There is no paid subscription for this workspace yet."}
            </p>
          )}
          {scheduledChange ? (
            <p className="mt-4 text-sm text-muted-foreground">
              At your next renewal: {scheduledChange.name} ·{" "}
              {amount(scheduledChange.amount, "USD")} /{" "}
              {scheduledChange.interval}.
            </p>
          ) : null}
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
      <div className="grid gap-6 md:grid-cols-2">
        {aiBalance ? (
          <section
            className="h-full rounded-xl border border-inbox-border bg-white p-6"
            aria-label="AI conversation allowance"
          >
            <h2 className="text-lg font-semibold">AI conversations</h2>
            <p className="mt-2 text-2xl font-semibold">
              {aiBalance.remaining.toLocaleString()} remaining{" "}
              <span className="text-sm font-normal text-muted-foreground">
                of {aiBalance.limit.toLocaleString()} this month
              </span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {aiBalance.used.toLocaleString()} used. Renews{" "}
              {new Date(aiBalance.end).toLocaleDateString("en-US", {
                timeZone: "UTC",
              })}
              .
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              A conversation counts once after a successful AI reply. Failed
              requests do not use your allowance. Your live chat keeps working
              when AI conversations run out.
            </p>
            {Boolean(aiUsage.history.length) && (
              <div className="mt-5 border-t pt-4">
                <h3 className="text-sm font-semibold">Recent AI usage</h3>
                <ul className="mt-2 space-y-2">
                  {aiUsage.history.map((entry) => (
                    <li
                      key={entry.conversation_id + entry.updated_at}
                      className="flex justify-between gap-4 text-sm"
                    >
                      <Link
                        className="text-primary hover:underline"
                        href={toAppRoute(
                          `/app/${workspaceSlug}/inbox/${entry.conversation_id}`,
                        )}
                      >
                        View conversation
                      </Link>
                      <span className="text-muted-foreground">
                        1 conversation ·{" "}
                        {new Date(entry.updated_at).toLocaleDateString(
                          "en-US",
                          {
                            timeZone: "UTC",
                          },
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            AI usage is temporarily unavailable. You can still manage your
            subscription and payment methods.
          </p>
        )}
        <Suspense
          fallback={
            <section
              className="rounded-xl border border-inbox-border bg-white p-6"
              aria-label="AI translation usage"
            >
              <h2 className="text-lg font-semibold">AI translations</h2>
              <p role="status" className="mt-2 text-sm text-muted-foreground">
                Loading your account balance…
              </p>
            </section>
          }
        >
          <AccountTranslationUsage workspaceId={workspace.workspace_id} />
        </Suspense>
      </div>
      {usesChargebee() ? (
        <SubscriptionManager
          slug={workspaceSlug}
          enabled={checkoutEnabled() && Boolean(state)}
          hasCard={Boolean(state?.defaultPaymentMethod)}
          subscriptionStatus={subscription?.status ?? null}
          initialPlan={
            MILL_PLANS.find(
              (p) =>
                typeof item?.price.product === "object" &&
                p.name === item.price.product.name,
            )?.id ?? "essential"
          }
          initialInterval={
            item?.price.recurring?.interval === "year" ? "year" : "month"
          }
        />
      ) : null}
      <BillingPaymentMethods
        slug={workspaceSlug}
        methods={state?.paymentMethods ?? []}
        defaultMethod={state?.defaultPaymentMethod ?? null}
        publishableKey={usesChargebee() ? null : stripePublishableKey()}
        chargebeeConfig={usesChargebee() ? chargebeeBrowserConfig() : null}
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
      {usesChargebee() ? (
        <CancelPlan
          slug={workspaceSlug}
          enabled={checkoutEnabled() && Boolean(state)}
          status={subscription?.status ?? null}
          periodEnd={renewal ?? null}
        />
      ) : null}
    </div>
  );
}
