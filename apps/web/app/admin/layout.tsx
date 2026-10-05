import { toAppRoute } from "@/lib/auth/redirect";
import Link from "next/link";
import {
  Building2,
  Layers,
  ReceiptText,
  History,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";
import { MILL_DIALOGUE_MARK } from "@site-chat/shared";
import { requirePlatformAdministrator } from "@/lib/platform-admin/guard";
export const dynamic = "force-dynamic";
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, role } = await requirePlatformAdministrator();
  return (
    <div className="min-h-dvh bg-[#f7f7f4] text-[#24323a]">
      <div className="grid min-h-dvh md:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-7 border-r bg-white p-5">
          <Link
            href={toAppRoute("/admin/customers")}
            className="flex items-center gap-3 text-3xl font-semibold tracking-tight"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- canonical Mill brand asset */}
            <img src={MILL_DIALOGUE_MARK} alt="" width={36} height={36} />
            Mill
          </Link>
          <p className="text-xs uppercase tracking-widest text-[#747b80]">
            Team administration
          </p>
          <nav
            aria-label="Platform administration"
            className="flex flex-wrap gap-2 md:flex-col"
          >
            {[
              { href: "/admin/customers", name: "Customers", Icon: Building2 },
              {
                href: "/admin/subscriptions",
                name: "Subscriptions",
                Icon: Layers,
              },
              { href: "/admin/billing", name: "Billing", Icon: ReceiptText },
              { href: "/admin/audit", name: "Audit log", Icon: History },
              { href: "/admin/team", name: "Team & roles", Icon: ShieldCheck },
            ].map(({ href, name, Icon }) => (
              <Link
                key={href}
                href={toAppRoute(href)}
                className="flex items-center gap-3 rounded-md px-2 py-3 text-sm hover:bg-[#edf3fc]"
              >
                <Icon className="size-4 text-[#1763de]" />
                {name}
              </Link>
            ))}
          </nav>
          <div className="mt-auto border-t pt-4 text-xs">
            <p className="break-all">{user.email}</p>
            <p className="mt-1 capitalize text-[#747b80]">Platform {role}</p>
            <Link
              href="/app"
              className="mt-5 flex items-center gap-2 text-[#1763de]"
            >
              <ArrowLeft className="size-3" />
              Your workspace
            </Link>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 text-sm">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Mill control room
            </span>
            <span className="text-xs text-[#747b80]">
              Internal administration · changes are audited
            </span>
          </header>
          <main className="mx-auto max-w-[1400px] p-5 lg:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
