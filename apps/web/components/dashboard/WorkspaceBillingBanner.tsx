import Link from "next/link";
import type { MemberRole } from "@site-chat/shared";
import { workspaceBillingAccessForRender } from "@/lib/billing/access";
import { toAppRoute } from "@/lib/auth/redirect";

/** Billing notices stream independently of the authorized workbench. */
export async function WorkspaceBillingBanner({
  workspaceId,
  slug,
  role,
}: {
  workspaceId: string;
  slug: string;
  role: MemberRole;
}) {
  const access = await workspaceBillingAccessForRender(workspaceId);
  const remaining =
    access.source === "trial" && !access.hasPaidSubscription && access.expiresAt
      ? Math.max(
          1,
          Math.ceil((Date.parse(access.expiresAt) - Date.now()) / 86400000),
        )
      : 0;
  const billingLink = toAppRoute(`/app/${slug}/billing`);
  const billingBanner = ["grace", "payment_overdue"].includes(access.source) ? (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#e1d6bf] bg-[#fbf6e9] px-4 py-2 text-sm text-[#594b32]"
    >
      <span>
        {access.source === "grace"
          ? `Payment overdue · your chat stays active until ${new Date(access.expiresAt ?? "").toLocaleDateString("en-US", { timeZone: "UTC" })}`
          : "Payment overdue · chat access is paused. Your conversations are preserved."}
      </span>
      {["owner", "admin"].includes(role) ? (
        <Link
          className="font-semibold underline underline-offset-4"
          href={billingLink}
        >
          Resolve payment
        </Link>
      ) : (
        <span>Contact your workspace owner.</span>
      )}
    </div>
  ) : null;
  const addOnBanner = access.addOnDebts.length ? (
    <span>
      Additional service payment overdue · unpaid add-ons are paused. Your base
      chat is unaffected by add-on debt.{" "}
      {["owner", "admin"].includes(role) ? (
        <a className="ml-3 underline" href={`/app/${slug}/billing`}>
          Resolve payment
        </a>
      ) : (
        " Contact your workspace owner."
      )}
    </span>
  ) : null;
  const trialBanner = remaining ? (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#e1d6bf] bg-[#fbf6e9] px-4 py-2 text-sm text-[#594b32]"
      role="status"
    >
      <span>
        Your Mill trial · {remaining} {remaining === 1 ? "day" : "days"}{" "}
        remaining
      </span>
      {["owner", "admin"].includes(role) ? (
        <Link
          className="font-semibold underline underline-offset-4"
          href={toAppRoute(`/app/${slug}/billing`)}
        >
          Choose a plan
        </Link>
      ) : (
        <span>Contact your workspace owner to upgrade.</span>
      )}
    </div>
  ) : null;
  return <>{billingBanner ?? addOnBanner ?? trialBanner}</>;
}
