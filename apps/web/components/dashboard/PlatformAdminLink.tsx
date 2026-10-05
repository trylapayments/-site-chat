import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { toAppRoute } from "@/lib/auth/redirect";
export function PlatformAdminLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href={toAppRoute("/admin/customers")}
      onClick={onNavigate}
      className="text-inbox-nav-muted hover:bg-inbox-nav-hover hover:text-inbox-nav-foreground flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-medium transition-colors"
    >
      <ShieldCheck className="size-[18px] shrink-0" aria-hidden={true} />
      Mill administration
    </Link>
  );
}
