"use client";
import { AdminDebtWriteOff } from "./AdminDebtWriteOff";
import { AdminPlanChange } from "./AdminPlanChange";
import { InvoiceDownload } from "@/components/settings/InvoiceDownload";
import { MILL_PLANS } from "@/lib/billing/plans";
import { CompanyIdentifier } from "./CompanyIdentifier";
import { toAppRoute } from "@/lib/auth/redirect";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Layers,
  Globe,
  Users,
  History,
  NotebookPen,
  ShieldCheck,
  ReceiptText,
  ArrowLeft,
} from "lucide-react";
import { WIDGET_STUDIO_FEATURES } from "@site-chat/shared";
import type { PlatformCustomer } from "@/lib/platform-admin/data";
import type { PlatformChange } from "@/lib/platform-admin/schema";
import { applyPlatformChange } from "@/lib/platform-admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanyProfile } from "@/lib/company/schema";
const box = "rounded-lg border bg-white p-5";
const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-US") : "—";
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-5 gap-y-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[#747b80]">{k}</dt>
          <dd className="max-w-[24rem] break-all text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
export function PlatformCustomerCard({ data }: { data: PlatformCustomer }) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const [tab, setTab] = useState("Overview");
  const [profile, setProfile] = useState(data.profile);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"standard" | "pilot">(
    data.controls?.access_mode === "pilot" ? "pilot" : "standard",
  );
  const [features, setFeatures] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        Object.entries(asRecord(data.controls?.features)).filter(
          ([, v]) => typeof v === "boolean",
        ),
      ) as Record<string, boolean>,
  );
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(asRecord(data.controls?.limits)).map(([k, v]) => [
        k,
        typeof v === "number" ? String(v) : "",
      ]),
    ),
  );
  const [expires, setExpires] = useState(
    data.controls?.override_expires_at?.slice(0, 10) ?? "",
  );
  const [trial, setTrial] = useState(
    data.controls?.trial_ends_at?.slice(0, 10) ?? "",
  );
  const [plan, setPlan] = useState(data.controls?.plan_id ?? "");
  const [planExpiry, setPlanExpiry] = useState(
    data.controls?.override_expires_at?.slice(0, 10) ?? "",
  );
  const [note, setNote] = useState("");
  const [domain, setDomain] = useState("");
  useEffect(() => {
    setPlan(data.controls?.plan_id ?? "");
    setPlanExpiry(data.controls?.override_expires_at?.slice(0, 10) ?? "");
    setProfile(data.profile);
    setMode(data.controls?.access_mode === "pilot" ? "pilot" : "standard");
    setFeatures(
      Object.fromEntries(
        Object.entries(asRecord(data.controls?.features)).filter(
          ([, v]) => typeof v === "boolean",
        ),
      ) as Record<string, boolean>,
    );
    setLimits(
      Object.fromEntries(
        Object.entries(asRecord(data.controls?.limits)).map(([k, v]) => [
          k,
          typeof v === "number" ? String(v) : "",
        ]),
      ),
    );
    setExpires(data.controls?.override_expires_at?.slice(0, 10) ?? "");
    setTrial(data.controls?.trial_ends_at?.slice(0, 10) ?? "");
  }, [data.profile, data.controls]);
  const owner = data.administratorRole === "owner",
    support = owner || data.administratorRole === "support";
  const finance = owner || data.administratorRole === "finance";
  function save(change: PlatformChange["change"]) {
    if (reason.trim().length < 3) {
      setMessage("Provide a reason before saving.");
      return;
    }
    startTransition(async () => {
      const result = await applyPlatformChange({
        workspaceId: data.workspace.id,
        version: data.controls?.version ?? 0,
        reason,
        change,
      });
      setMessage(result.message);
      if (result.success) {
        setReason("");
        setNote("");
        router.refresh();
      }
    });
  }
  const reasonField = (suffix = "main") => (
    <div className="mt-5 space-y-2">
      <Label htmlFor={`admin-reason-${suffix}`}>Reason for this change</Label>
      <Input
        id={`admin-reason-${suffix}`}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        maxLength={2000}
        placeholder="Required for the audit log"
        disabled={pending}
      />
    </div>
  );
  const actionButton = (
    label: string,
    change: PlatformChange["change"],
    allowed = owner,
  ) => (
    <Button
      type="button"
      className="mt-4"
      disabled={pending || !allowed}
      onClick={() => {
        save(change);
      }}
    >
      {pending ? "Saving…" : label}
    </Button>
  );
  const tabs = [
    { name: "Overview", Icon: Building2 },
    { name: "Company", Icon: Building2 },
    { name: "Access & limits", Icon: ShieldCheck },
    { name: "Billing", Icon: ReceiptText },
    { name: "Team", Icon: Users },
    { name: "Domains", Icon: Globe },
    { name: "Notes", Icon: NotebookPen },
    { name: "Activity", Icon: History },
  ];
  return (
    <div>
      <Link
        href={toAppRoute("/admin/customers")}
        className="mb-5 inline-flex items-center gap-2 text-sm text-[#1763de]"
      >
        <ArrowLeft className="size-4" />
        Customers
      </Link>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.workspace.name}
          </h1>
          <CompanyIdentifier id={data.workspace.id} />
          {owner ? (
            <Link
              className="mt-3 inline-block text-sm text-primary"
              href={`/admin/customers/${data.workspace.id}/widget`}
            >
              Manage custom launcher icon
            </Link>
          ) : null}
          <p className="mt-2 text-sm text-[#747b80]">
            {data.profile.website || data.workspace.slug} ·{" "}
            {data.profile.email || "No company email"}
          </p>
        </div>
        <span className="rounded-md bg-[#edf3fc] px-3 py-1.5 text-sm capitalize text-[#1763de]">
          {data.workspace.status}
        </span>
      </header>
      <div
        className="mb-6 flex flex-wrap gap-5 border-b"
        role="tablist"
        aria-label="Customer administration"
      >
        {tabs.map(({ name, Icon }) => (
          <button
            type="button"
            role="tab"
            disabled={!hydrated}
            key={name}
            id={`admin-tab-${name.replaceAll(" ", "")}`}
            aria-selected={tab === name}
            aria-controls="admin-customer-panel"
            onClick={() => {
              setTab(name);
              setMessage("");
            }}
            className={`flex items-center gap-2 border-b-2 pb-3 text-sm ${tab === name ? "border-[#1763de] text-[#1763de]" : "border-transparent text-[#747b80]"}`}
          >
            <Icon className="size-4" />
            {name}
          </button>
        ))}
      </div>
      {message ? (
        <p
          role="status"
          className="mb-5 rounded-md border bg-white p-3 text-sm"
        >
          {message}
        </p>
      ) : null}
      <div
        id="admin-customer-panel"
        role="tabpanel"
        aria-labelledby={`admin-tab-${tab.replaceAll(" ", "")}`}
      >
        {tab === "Overview" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className={box}>
              <h2 className="flex items-center gap-2 font-semibold">
                <Layers className="size-4" />
                Access
              </h2>
              <Facts
                rows={[
                  ["Access mode", data.controls?.access_mode ?? "Standard"],
                  ["Trial ends", date(data.controls?.trial_ends_at)],
                  [
                    "Overrides expire",
                    date(data.controls?.override_expires_at),
                  ],
                  ["Last modified", date(data.controls?.updated_at)],
                ]}
              />
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => {
                  setTab("Access & limits");
                }}
              >
                Manage access
              </Button>
            </section>
            <section className={box}>
              <h2 className="font-semibold">Workspace</h2>
              <Facts
                rows={[
                  ["Workspace ID", data.workspace.id],
                  ["Slug", data.workspace.slug],
                  ["Created", date(data.workspace.created_at)],
                  ["Team members", data.members.length],
                  [
                    "Allowed domains",
                    data.domains.filter((d) => d.verified).length,
                  ],
                ]}
              />
            </section>
            <section className={box}>
              <h2 className="font-semibold">Usage</h2>
              <Facts
                rows={[
                  ["All conversations", data.usage.conversations],
                  ["Open conversations", data.usage.openConversations],
                ]}
              />
              <p className="mt-4 text-xs text-[#747b80]">
                AI and storage metering will appear once connected. No estimated
                usage is shown.
              </p>
            </section>
            <section className={box}>
              <h2 className="font-semibold">Workspace status</h2>
              <p className="mt-3 text-sm text-[#747b80]">
                Suspension blocks new widget access and preserves customer
                history. Restoration re-enables the workspace.
              </p>
              {owner ? (
                <>
                  {reasonField()}
                  <Button
                    variant="outline"
                    className="mt-4"
                    disabled={pending}
                    onClick={() => {
                      const status =
                        data.workspace.status === "suspended"
                          ? "active"
                          : "suspended";
                      if (
                        window.confirm(
                          `${status === "suspended" ? "Suspend" : "Restore"} ${data.workspace.name}?`,
                        )
                      )
                        save({ action: "status", payload: { status } });
                    }}
                  >
                    {data.workspace.status === "suspended"
                      ? "Restore workspace"
                      : "Suspend workspace"}
                  </Button>
                </>
              ) : null}
            </section>
          </div>
        ) : null}
        {tab === "Company" ? (
          <section className={box}>
            <h2 className="font-semibold">Company information</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {(Object.keys(profile) as (keyof CompanyProfile)[]).map((key) => (
                <div key={key}>
                  <Label htmlFor={`company-${key}`}>
                    {
                      {
                        name: "Workspace name",
                        legalName: "Legal company name",
                        website: "Website",
                        email: "Company email",
                        phone: "Phone",
                        addressLine1: "Address line 1",
                        addressLine2: "Address line 2",
                        city: "City",
                        region: "State / region",
                        postalCode: "Postal code",
                        country: "Country (ISO code)",
                        taxId: "Tax ID",
                      }[key]
                    }
                  </Label>
                  <Input
                    id={`company-${key}`}
                    value={profile[key]}
                    disabled={!owner || pending}
                    onChange={(e) => {
                      setProfile({
                        ...profile,
                        [key]:
                          key === "country"
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                      });
                    }}
                  />
                </div>
              ))}
            </div>
            {owner ? (
              <>
                {reasonField()}
                {actionButton("Save company", {
                  action: "company",
                  payload: profile,
                })}
              </>
            ) : null}
          </section>
        ) : null}
        {tab === "Access & limits" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className={box}>
              <h2 className="font-semibold">Access & feature overrides</h2>
              <Label className="mt-5 block" htmlFor="access-mode">
                Access mode
              </Label>
              <select
                id="access-mode"
                className="mt-2 w-full rounded-md border px-3 py-2"
                disabled={!owner || pending}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as "standard" | "pilot");
                }}
              >
                <option value="standard">Standard access</option>
                <option value="pilot">
                  Full pilot access · no automatic expiry
                </option>
              </select>
              <p className="mt-3 text-xs text-[#747b80]">
                Pilot grants all widget features. Standard uses plan defaults,
                with the overrides below.
              </p>
              <div className="mt-5 divide-y">
                {WIDGET_STUDIO_FEATURES.map((feature) => (
                  <div
                    key={feature}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <Label
                      htmlFor={`feature-${feature}`}
                      className="capitalize"
                    >
                      {feature.replaceAll("_", " ")}
                    </Label>
                    <select
                      id={`feature-${feature}`}
                      className="rounded border px-2 py-1 text-sm"
                      value={
                        feature in features
                          ? String(features[feature])
                          : "default"
                      }
                      disabled={!owner || pending}
                      onChange={(e) => {
                        const next = { ...features };
                        if (e.target.value === "default") {
                          const filtered = Object.fromEntries(
                            Object.entries(next).filter(
                              ([key]) => key !== feature,
                            ),
                          );
                          setFeatures(filtered);
                          return;
                        } else next[feature] = e.target.value === "true";
                        setFeatures(next);
                      }}
                    >
                      <option value="default">Plan default</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                ))}
              </div>
              <Label htmlFor="override-expiry" className="mt-5 block">
                Override expiry (optional)
              </Label>
              <Input
                id="override-expiry"
                type="date"
                value={expires}
                disabled={!owner || pending}
                onChange={(e) => {
                  setExpires(e.target.value);
                }}
              />
              {owner ? (
                <>
                  {reasonField()}
                  {actionButton("Save access & limits", {
                    action: "access",
                    payload: {
                      access_mode: mode,
                      features,
                      limits: {
                        operator_seats: limits.operator_seats
                          ? Number(limits.operator_seats)
                          : null,
                        websites: limits.websites
                          ? Number(limits.websites)
                          : null,
                        monthly_conversations: limits.monthly_conversations
                          ? Number(limits.monthly_conversations)
                          : null,
                        monthly_ai_requests: limits.monthly_ai_requests
                          ? Number(limits.monthly_ai_requests)
                          : null,
                        storage_mb: limits.storage_mb
                          ? Number(limits.storage_mb)
                          : null,
                      },
                      override_expires_at: expires
                        ? new Date(expires + "T23:59:59Z").toISOString()
                        : null,
                    },
                  })}
                </>
              ) : null}
            </section>
            <div>
              <section className={`${box} mb-5`}>
                <h2 className="font-semibold">Complimentary plan</h2>
                <p className="mt-2 text-xs text-[#747b80]">
                  Grant a plan without payment. Removing a grant returns access
                  to the billing subscription; it does not cancel payments.
                </p>
                <Label htmlFor="complimentary-plan" className="mt-4 block">
                  Plan
                </Label>
                <select
                  id="complimentary-plan"
                  value={plan}
                  disabled={!owner || pending}
                  className="mt-2 w-full rounded-md border px-3 py-2"
                  onChange={(e) => {
                    setPlan(e.target.value);
                  }}
                >
                  <option value="">Use billing subscription</option>
                  {MILL_PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · complimentary
                    </option>
                  ))}
                </select>
                <Label htmlFor="plan-expiry" className="mt-4 block">
                  Grant expires (optional)
                </Label>
                <Input
                  id="plan-expiry"
                  type="date"
                  value={planExpiry}
                  disabled={!owner || pending || !plan}
                  onChange={(e) => {
                    setPlanExpiry(e.target.value);
                  }}
                />
                <p className="mt-2 text-xs text-[#747b80]">
                  Leave empty for no expiry.
                </p>
                {owner ? (
                  <>
                    {reasonField("plan")}
                    {actionButton("Save plan grant", {
                      action: "plan",
                      payload: {
                        plan_id: plan || null,
                        expires_at:
                          plan && planExpiry
                            ? new Date(planExpiry + "T23:59:59Z").toISOString()
                            : null,
                      },
                    })}
                  </>
                ) : null}
              </section>
              <section className={box}>
                <h2 className="font-semibold">Individual limits</h2>
                <p className="mt-2 text-xs text-[#747b80]">
                  Operator and website limits are enforced. Other allowances are
                  saved for the upcoming metering integration.
                </p>
                <div className="mt-5 space-y-4">
                  {[
                    { key: "operator_seats", label: "Operator seats" },
                    { key: "websites", label: "Websites" },
                    {
                      key: "monthly_conversations",
                      label: "Monthly conversations",
                    },
                    {
                      key: "monthly_ai_requests",
                      label: "Monthly AI requests",
                    },
                    { key: "storage_mb", label: "Storage (MB)" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <Label htmlFor={`limit-${key}`}>{label}</Label>
                      <Input
                        id={`limit-${key}`}
                        type="number"
                        min={key === "monthly_ai_requests" ? 0 : 1}
                        value={limits[key] ?? ""}
                        placeholder="Plan default"
                        disabled={!owner || pending}
                        onChange={(e) => {
                          setLimits({ ...limits, [key]: e.target.value });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </section>
              <section className={`${box} mt-5`}>
                <h2 className="font-semibold">Trial</h2>
                <Facts
                  rows={[
                    ["Current trial end", date(data.controls?.trial_ends_at)],
                  ]}
                />
                <Label htmlFor="trial-end" className="mt-4 block">
                  New trial end date
                </Label>
                <Input
                  id="trial-end"
                  type="date"
                  value={trial}
                  disabled={!support || pending}
                  onChange={(e) => {
                    setTrial(e.target.value);
                  }}
                />
                <p className="mt-3 text-xs text-[#747b80]">
                  Grant or extend a Mill trial independently of billing.
                  Existing paid subscriptions are unchanged.
                </p>
                {support ? (
                  <>
                    {reasonField("trial")}
                    <Button
                      className="mt-4"
                      disabled={pending || !trial}
                      onClick={() => {
                        save({
                          action: "trial",
                          payload: {
                            trial_ends_at: new Date(
                              trial + "T23:59:59Z",
                            ).toISOString(),
                          },
                        });
                      }}
                    >
                      Save trial end
                    </Button>
                  </>
                ) : null}
              </section>
            </div>
          </div>
        ) : null}
        {tab === "Billing" ? (
          <div className="space-y-5">
            {!finance ? (
              <p className={box}>
                Your platform role does not grant access to billing.
              </p>
            ) : (
              <>
                <section className={box}>
                  <h2 className="font-semibold">Subscription</h2>
                  {data.billingError ? (
                    <p role="alert" className="mt-4">
                      Billing is temporarily unavailable.
                    </p>
                  ) : data.billing?.subscriptions.length ? (
                    <div className="mt-4 space-y-3">
                      {data.billing.subscriptions.map((s) => (
                        <div key={s.id}>
                          <p>
                            {s.items.data
                              .map((item) =>
                                typeof item.price.product === "object"
                                  ? item.price.product.name
                                  : "Mill plan",
                              )
                              .join(", ")}{" "}
                            · {s.status}
                          </p>
                          <p className="text-xs text-[#747b80]">
                            Current term ends{" "}
                            {s.current_period_end
                              ? date(
                                  new Date(
                                    s.current_period_end * 1000,
                                  ).toISOString(),
                                )
                              : "—"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[#747b80]">
                      No connected subscription. Pilot or trial access does not
                      start paid billing.
                    </p>
                  )}
                  {data.billing?.scheduledChange ? (
                    <p className="mt-4 text-sm text-[#747b80]">
                      Next renewal: {data.billing.scheduledChange.name} ·{" "}
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                      }).format(data.billing.scheduledChange.amount / 100)}{" "}
                      / {data.billing.scheduledChange.interval}
                    </p>
                  ) : null}
                  <p className="mt-4 text-xs text-[#747b80]">
                    Subscription and payment records are synchronised from the
                    billing provider. Complimentary access, trials and
                    suspension are controlled independently in Access & limits.
                  </p>
                  <AdminPlanChange
                    currentPlan={
                      MILL_PLANS.find((p) =>
                        data.billing?.subscriptions[0]?.items.data.some(
                          (item) =>
                            typeof item.price.product === "object" &&
                            item.price.product.name === p.name,
                        ),
                      )?.id ?? "essential"
                    }
                    currentInterval={
                      data.billing?.subscriptions[0]?.items.data[0]?.price
                        .recurring?.interval === "year"
                        ? "year"
                        : "month"
                    }
                    workspaceId={data.workspace.id}
                    enabled={
                      !data.billingError &&
                      Boolean(
                        data.billing?.subscriptions.some(
                          (s) => s.status === "active",
                        ),
                      )
                    }
                  />
                </section>
                <section className={box}>
                  <h2 className="font-semibold">Payment methods</h2>
                  {data.billing?.paymentMethods.length ? (
                    data.billing.paymentMethods.map((m) => (
                      <p key={m.id} className="mt-3 text-sm">
                        {m.card?.brand} · ending in {m.card?.last4} · expires{" "}
                        {m.card?.exp_month}/{m.card?.exp_year}
                      </p>
                    ))
                  ) : (
                    <p className="mt-4 text-sm text-[#747b80]">
                      No saved payment methods.
                    </p>
                  )}
                </section>
                <AdminDebtWriteOff workspaceId={data.workspace.id} />
                <section className={box}>
                  <h2 className="font-semibold">Invoices</h2>
                  {data.billing?.invoices.length ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr>
                            <th>Invoice</th>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Download</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.billing.invoices.map((i) => (
                            <tr key={i.id} className="border-t">
                              <td className="py-3">{i.number}</td>
                              <td>
                                {date(new Date(i.created * 1000).toISOString())}
                              </td>
                              <td>
                                {new Intl.NumberFormat("en-US", {
                                  style: "currency",
                                  currency: i.currency,
                                }).format(i.total / 100)}
                              </td>
                              <td>{i.status}</td>
                              <td>
                                {i.invoice_pdf ? (
                                  <InvoiceDownload
                                    slug={data.workspace.slug}
                                    adminWorkspaceId={data.workspace.id}
                                    invoiceId={i.id}
                                  />
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[#747b80]">No invoices.</p>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}
        {tab === "Team" ? (
          <section className={box}>
            <h2 className="font-semibold">Workspace team</h2>
            <p className="mt-2 text-sm text-[#747b80]">
              Workspace membership grants no platform administration access. The
              last active owner cannot be removed.
            </p>
            <div className="mt-5 space-y-4">
              {data.members.map((m) => (
                <MemberEditor
                  key={`${m.id}-${m.role}-${m.status}`}
                  member={m}
                  editable={owner}
                  pending={pending}
                  save={save}
                />
              ))}
            </div>
            {owner ? reasonField() : null}
          </section>
        ) : null}
        {tab === "Domains" ? (
          <section className={box}>
            <h2 className="font-semibold">Allowed domains</h2>
            <p className="mt-2 text-sm text-[#747b80]">
              Only explicitly allowed websites can use the widget. Allow a
              domain only after ownership has been checked.
            </p>
            <ul className="mt-4 divide-y">
              {data.domains.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span>
                    {d.domain} · {d.verified ? "Allowed" : "Blocked"}
                  </span>
                  {owner ? (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `${d.verified ? "Block" : "Allow"} ${d.domain}?`,
                          )
                        )
                          save({
                            action: "domain",
                            payload: {
                              domain: d.domain,
                              operation: d.verified ? "block" : "allow",
                            },
                          });
                      }}
                    >
                      {d.verified ? "Block" : "Allow"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {owner ? (
              <>
                <Label htmlFor="new-domain" className="mt-5 block">
                  New domain
                </Label>
                <Input
                  id="new-domain"
                  value={domain}
                  onChange={(e) => {
                    setDomain(e.target.value);
                  }}
                  placeholder="example.com"
                />
                {reasonField()}
                <Button
                  className="mt-4"
                  disabled={pending || !domain}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Confirm ownership has been checked and allow ${domain}?`,
                      )
                    )
                      save({
                        action: "domain",
                        payload: { domain, operation: "allow" },
                      });
                  }}
                >
                  Allow domain
                </Button>
              </>
            ) : null}
          </section>
        ) : null}
        {tab === "Notes" ? (
          <section className={box}>
            <h2 className="font-semibold">Internal customer notes</h2>
            <p className="mt-2 text-sm text-[#747b80]">
              Visible only to the Mill platform team.
            </p>
            {support ? (
              <>
                <Label htmlFor="customer-note" className="mt-4 block">
                  New note
                </Label>
                <textarea
                  id="customer-note"
                  className="mt-2 min-h-28 w-full rounded-md border p-3"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                  maxLength={5000}
                />
                {reasonField()}
                {actionButton(
                  "Add note",
                  { action: "note", payload: { body: note } },
                  support,
                )}
              </>
            ) : null}
            <ul className="mt-6 divide-y">
              {data.notes.map((n) => (
                <li key={n.id} className="py-4">
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                  <p className="mt-2 text-xs text-[#747b80]">
                    {date(n.created_at)} · {n.author_id}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {tab === "Activity" ? (
          <section className={box}>
            <h2 className="font-semibold">Audit history</h2>
            <p className="mt-2 text-xs text-[#747b80]">
              Latest 100 changes. Records cannot be edited through the
              administration interface.
            </p>
            <ul className="mt-4 divide-y">
              {data.audit.map((a) => (
                <li key={a.id} className="py-4">
                  <p className="text-sm font-semibold capitalize">
                    {a.action.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-sm">{a.reason}</p>
                  <p className="mt-2 text-xs text-[#747b80]">
                    {date(a.created_at)} · {a.actor_id}
                  </p>
                  <details className="mt-3 text-xs">
                    <summary>Before & after</summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded border bg-[#f7f7f4] p-3">
                      {JSON.stringify(
                        { before: a.before_json, after: a.after_json },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
            {!data.audit.length ? (
              <p className="mt-4 text-sm text-[#747b80]">
                No platform changes yet.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
function MemberEditor({
  member,
  editable,
  pending,
  save,
}: {
  member: PlatformCustomer["members"][number];
  editable: boolean;
  pending: boolean;
  save: (c: PlatformChange["change"]) => void;
}) {
  const [role, setRole] = useState(member.role),
    [status, setStatus] = useState(member.status);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
      <div>
        <p className="text-sm font-semibold">
          {member.name || member.email || member.user_id}
        </p>
        <p className="mt-1 text-xs text-[#747b80]">
          {member.email} · Last sign-in {date(member.lastSignIn)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded border px-2 py-2 text-sm"
          aria-label={`Role for ${member.email}`}
          disabled={!editable || pending}
          value={role}
          onChange={(e) => {
            setRole(e.target.value as typeof role);
          }}
        >
          {["owner", "admin", "agent", "viewer"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select
          className="rounded border px-2 py-2 text-sm"
          aria-label={`Status for ${member.email}`}
          disabled={!editable || pending}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
          }}
        >
          <option>active</option>
          <option>deactivated</option>
        </select>
        {editable ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Change access for ${member.email}?`))
                save({
                  action: "member",
                  payload: { member_id: member.id, role, status },
                });
            }}
          >
            Save member
          </Button>
        ) : null}
      </div>
    </div>
  );
}
