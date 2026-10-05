import Link from "next/link";
import { requirePlatformAdministrator } from "@/lib/platform-admin/guard";
import { createServiceClient } from "@/lib/supabase/service";
import { toAppRoute } from "@/lib/auth/redirect";
import { notFound } from "next/navigation";
export default async function Billing() {
  const { role } = await requirePlatformAdministrator();
  if (!["owner", "finance"].includes(role)) notFound();
  const { data, error } = await createServiceClient()
    .from("workspace_chargebee_accounts")
    .select("workspace_id,site,customer_id,synced_at")
    .order("synced_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw new Error("Billing accounts unavailable.");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Billing accounts</h1>
      <p className="mt-2 text-sm text-[#747b80]">
        Connected Chargebee customers. No payments are initiated from this list.
      </p>
      <div className="mt-6 divide-y rounded-lg border bg-white">
        {data.map((a) => (
          <Link
            key={`${a.site}-${a.customer_id}`}
            href={toAppRoute(`/admin/customers/${a.workspace_id}`)}
            className="block p-5"
          >
            <p className="font-semibold">{a.customer_id}</p>
            <p className="mt-1 text-sm text-[#747b80]">
              {a.site} · last sync{" "}
              {a.synced_at
                ? new Date(a.synced_at).toLocaleString("en-US")
                : "Not synced"}
            </p>
          </Link>
        ))}
        {!data.length ? (
          <p className="p-6 text-sm text-[#747b80]">
            No companies have a connected Chargebee account yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
