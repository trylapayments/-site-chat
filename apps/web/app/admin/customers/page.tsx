import { toAppRoute } from "@/lib/auth/redirect";
import Link from "next/link";
import { loadPlatformCustomers } from "@/lib/platform-admin/data";
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: rawPage = "1" } = await searchParams;
  const page = Math.min(10000, Math.max(1, Number(rawPage) || 1));
  const { customers, count } = await loadPlatformCustomers(
    q.slice(0, 100),
    page,
  );
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
      <p className="mt-2 text-sm text-[#747b80]">
        Every company, subscription and exception in one place.
      </p>
      <form className="my-6 flex gap-3">
        <input
          name="q"
          defaultValue={q}
          aria-label="Search companies"
          placeholder="Search companies…"
          className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2"
        />
        <button className="rounded-md bg-[#1763de] px-4 py-2 text-white">
          Search
        </button>
      </form>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f7f7f4] text-xs text-[#747b80]">
            <tr>
              {["Company", "Status", "Access", "Trial ends", "Created"].map(
                (h) => (
                  <th key={h} className="px-5 py-3 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-5 py-5">
                  <Link
                    className="font-semibold text-[#1763de]"
                    href={toAppRoute(`/admin/customers/${c.id}`)}
                  >
                    {c.name}
                  </Link>
                  <p className="mt-1 text-xs text-[#747b80]">{c.slug}</p>
                </td>
                <td className="px-5 py-5 capitalize">{c.status}</td>
                <td className="px-5 py-5 capitalize">
                  {c.controls?.access_mode ?? "Standard"}
                </td>
                <td className="px-5 py-5">
                  {c.controls?.trial_ends_at
                    ? new Date(c.controls.trial_ends_at).toLocaleDateString(
                        "en-US",
                      )
                    : "—"}
                </td>
                <td className="px-5 py-5">
                  {new Date(c.created_at).toLocaleDateString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!customers.length ? (
          <p className="p-6 text-sm text-[#747b80]">No matching companies.</p>
        ) : null}
        <div className="flex justify-between border-t p-4 text-xs">
          <span>
            {count} companies · page {page}
          </span>
          <div className="flex gap-4">
            {page > 1 ? (
              <Link
                href={`?q=${encodeURIComponent(q)}&page=${String(page - 1)}`}
              >
                Previous
              </Link>
            ) : null}
            {page * 25 < count ? (
              <Link
                href={`?q=${encodeURIComponent(q)}&page=${String(page + 1)}`}
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
