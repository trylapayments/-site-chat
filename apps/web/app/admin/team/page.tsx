import { PlatformTeamEditor } from "@/components/platform-admin/PlatformTeamEditor";
import { requirePlatformAdministrator } from "@/lib/platform-admin/guard";
import { createServiceClient } from "@/lib/supabase/service";
import { notFound } from "next/navigation";
export default async function Team() {
  const { role } = await requirePlatformAdministrator();
  if (role !== "owner") notFound();
  const service = createServiceClient();
  const { data, error } = await service
    .from("platform_administrators")
    .select("user_id,role,enabled,created_at");
  if (error) throw new Error("Platform team unavailable.");
  const members = await Promise.all(
    data.map(async (m) => {
      const { data } = await service.auth.admin.getUserById(m.user_id);
      return { ...m, email: data.user?.email ?? m.user_id };
    }),
  );
  return (
    <div>
      <h1 className="text-2xl font-semibold">Platform team & roles</h1>
      <p className="mt-2 text-sm text-[#747b80]">
        Platform permissions are separate from customer workspace roles.
      </p>
      <div className="mt-6 divide-y rounded-lg border bg-white">
        {members.map((m) => (
          <div
            key={m.user_id}
            className="flex flex-wrap justify-between gap-3 p-5"
          >
            <span>{m.email}</span>
            <span className="text-sm capitalize">
              {m.role} · {m.enabled ? "Active" : "Disabled"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">Role scopes</h2>
        <ul className="mt-4 space-y-3 text-sm">
          <li>
            <b>Owner:</b> company data, access, domains, workspace members,
            notes and billing visibility.
          </li>
          <li>
            <b>Support:</b> customer records, notes and unconnected access trial
            extensions.
          </li>
          <li>
            <b>Finance:</b> customer records and billing visibility.
          </li>
          <li>
            <b>Viewer:</b> read-only customer records.
          </li>
        </ul>
      </div>
      <PlatformTeamEditor />
    </div>
  );
}
