import Link from "next/link";
import { toAppRoute } from "@/lib/auth/redirect";
import { loadPlatformCustomers } from "@/lib/platform-admin/data";
export default async function Subscriptions() {
  const { customers, count } = await loadPlatformCustomers();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Subscriptions & access</h1>
      <p className="mt-2 text-sm text-[#747b80]">
        Open a company to manage its access, trial and connected subscription.
      </p>
      <div className="mt-6 divide-y rounded-lg border bg-white">
        {customers.map((c) => (
          <Link
            key={c.id}
            href={toAppRoute(`/admin/customers/${c.id}`)}
            className="flex flex-wrap justify-between gap-3 p-5"
          >
            <span className="font-semibold">{c.name}</span>
            <span className="text-sm capitalize">
              {c.controls?.access_mode ?? "standard"} · {c.status}
              {c.controls?.trial_ends_at
                ? ` · trial ends ${new Date(c.controls.trial_ends_at).toLocaleDateString("en-US")}`
                : ""}
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-[#747b80]">
        Showing {customers.length} of {count}. Use Customers search for the full
        list.
      </p>
    </div>
  );
}
