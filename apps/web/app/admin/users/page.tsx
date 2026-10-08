import Link from "next/link";
import { listPlatformAccounts } from "@/lib/platform-admin/account-actions";
import { PlatformAccountEditor } from "@/components/platform-admin/PlatformAccountEditor";
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: raw = "1" } = await searchParams;
  const page = Math.max(1, Math.min(10000, Number(raw) || 1));
  const { users, count } = await listPlatformAccounts(q, page);
  return (
    <div>
      <h1 className="text-2xl font-semibold">User accounts</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage login addresses and remove old accounts. Only Mill platform
        owners can make changes.
      </p>
      <form className="my-6 flex gap-3">
        <input
          className="min-w-0 flex-1 rounded-md border p-3"
          name="q"
          defaultValue={q}
          placeholder="Search email address"
          aria-label="Search email address"
        />
        <button className="rounded-md bg-blue-600 px-4 text-white">
          Search
        </button>
      </form>
      <div className="space-y-4">
        {users.map((account) => (
          <section key={account.id} className="rounded-xl border bg-white p-5">
            <div className="mb-4 flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="font-semibold break-all">
                  {account.email ?? "No email"}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {account.confirmed ? "Confirmed" : "Unconfirmed"} ·{" "}
                  {account.workspaces.length} companies
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                Created{" "}
                {new Date(account.createdAt).toLocaleDateString("en-US")}
              </span>
            </div>
            <PlatformAccountEditor account={account} />
          </section>
        ))}
      </div>
      {!users.length && <p>No matching accounts.</p>}
      <div className="mt-6 flex justify-between text-sm">
        <span>{count} accounts</span>
        <div className="flex gap-4">
          {page > 1 && (
            <Link href={`?q=${encodeURIComponent(q)}&page=${String(page - 1)}`}>
              Previous
            </Link>
          )}
          {page * 25 < count && (
            <Link href={`?q=${encodeURIComponent(q)}&page=${String(page + 1)}`}>
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
