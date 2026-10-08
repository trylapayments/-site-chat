import { toAppRoute } from "@/lib/auth/redirect";
import Link from "next/link";
export function SitePicker({
  slug,
  sites,
  selected,
  section,
}: {
  slug: string;
  sites: string[];
  selected?: string;
  section: "widget-studio" | "chat-setup";
}) {
  return (
    <section className="rounded-2xl border bg-white p-4 space-y-3">
      <h2 className="font-semibold">Website settings</h2>
      <p className="text-sm text-muted-foreground">
        Choose a website to edit its own branding and chat rules. Workspace
        defaults apply until you save settings for that website.
      </p>
      <div className="flex flex-wrap gap-2">
        {[undefined, ...sites].map((site) => (
          <Link
            key={site ?? "default"}
            className={`rounded-xl border px-4 py-2 text-sm ${site === selected ? "bg-blue-50 border-blue-400 text-blue-700" : "hover:bg-slate-50"}`}
            href={toAppRoute(
              `/app/${slug}/settings/${section}${site ? `?site=${encodeURIComponent(site)}` : ""}`,
            )}
          >
            {site ?? "Workspace defaults"}
          </Link>
        ))}
      </div>
      {selected ? (
        <div className="flex gap-4 text-sm">
          <Link
            className="text-blue-600 underline"
            href={`/app/${slug}/settings/widget-studio?site=${encodeURIComponent(selected)}`}
          >
            Widget design
          </Link>
          <Link
            className="text-blue-600 underline"
            href={`/app/${slug}/settings/chat-setup?site=${encodeURIComponent(selected)}`}
          >
            Chat rules
          </Link>
        </div>
      ) : null}
    </section>
  );
}
