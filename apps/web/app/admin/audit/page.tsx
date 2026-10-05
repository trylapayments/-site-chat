import Link from "next/link";
import { requirePlatformAdministrator } from "@/lib/platform-admin/guard";
import { createServiceClient } from "@/lib/supabase/service";
import { toAppRoute } from "@/lib/auth/redirect";
export default async function Audit() {
  await requirePlatformAdministrator();
  const { data, error } = await createServiceClient()
    .from("platform_audit_log")
    .select("id,actor_id,workspace_id,action,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Audit history unavailable.");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="mt-2 text-sm text-[#747b80]">
        Latest 100 platform changes. Each entry records an actor and a reason.
      </p>
      <ul className="mt-6 divide-y rounded-lg border bg-white">
        {data.map((a) => (
          <li key={a.id} className="p-5">
            <p className="font-semibold capitalize">{a.action}</p>
            <p className="mt-1 text-sm">{a.reason}</p>
            <p className="mt-2 text-xs text-[#747b80]">
              {new Date(a.created_at).toLocaleString("en-US")} · {a.actor_id}
            </p>
            {a.workspace_id ? (
              <Link
                className="mt-3 inline-block text-sm text-[#1763de]"
                href={toAppRoute(`/admin/customers/${a.workspace_id}`)}
              >
                Open company
              </Link>
            ) : null}
          </li>
        ))}
        {!data.length ? (
          <li className="p-6 text-sm text-[#747b80]">
            No platform changes yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
