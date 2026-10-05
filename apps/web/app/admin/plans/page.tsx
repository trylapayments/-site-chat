import { Check, MessageSquareText, Sparkles } from "lucide-react";
import { MILL_PLANS, MILL_PRICING, formatMillPrice } from "@/lib/billing/plans";
export default function PlansPage() {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-widest text-[#747b80]">
          Mill product catalogue
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Plans</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#747b80]">
          One clear monthly price for your team. Approved pricing for launch;
          paid checkout and automatic limits are not enabled yet. Existing pilot
          access continues.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MILL_PLANS.map((plan) => (
          <section
            key={plan.id}
            className="flex flex-col rounded-xl border bg-white p-6"
          >
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-2 min-h-10 text-sm text-[#747b80]">
              {plan.description}
            </p>
            <p className="mt-5">
              <span className="text-3xl font-semibold tracking-tight">
                {formatMillPrice(plan.monthlyPriceCents)}
              </span>
              <span className="text-sm text-[#747b80]"> / month</span>
            </p>
            <p className="mt-1 text-xs text-[#747b80]">
              Per workspace · USD · taxes excluded
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              <li>{plan.operators} operators included</li>
              <li>
                {plan.sites} {plan.sites === 1 ? "website" : "websites"}
              </li>
              <li className="flex gap-2">
                <MessageSquareText className="size-4 shrink-0 text-[#1763de]" />
                Live chat, attachments & notifications
              </li>
              <li className="flex gap-2">
                <Check className="size-4 shrink-0 text-[#1763de]" />
                {plan.removeBranding
                  ? "Remove Mill branding"
                  : "Powered by Mill"}
              </li>
            </ul>
            <div className="mt-6 border-t pt-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-[#1763de]" /> Mill AI
              </p>
              <p className="mt-2 text-sm">
                {plan.aiConversations > 0
                  ? `${plan.aiConversations.toLocaleString("en-US")} AI conversations / month included`
                  : "Not included"}
              </p>
              {plan.aiConversations > 0 && (
                <p className="mt-2 text-xs text-[#747b80]">Coming soon</p>
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="text-sm text-[#747b80]">
        Mill AI answers visitor questions and hands over to your team when
        needed. Included allowances will be available when Mill AI launches.
        After the monthly allowance is used, AI pauses and human chat continues.
        Additional packages and pricing are not configured.
      </p>
      <p className="text-sm text-[#747b80]">
        {MILL_PRICING.trialDays}-day trial without a card. No permanent free
        plan. Human conversations are not billed per message. Annual billing is
        not configured.
      </p>
    </div>
  );
}
