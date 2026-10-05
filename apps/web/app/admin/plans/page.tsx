import { Check, Sparkles, Bot, MessageSquareText } from "lucide-react";
import { MILL_PLANS, MILL_PRICING, formatMillPrice } from "@/lib/billing/plans";
export default function PlansPage() {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-widest text-[#747b80]">
          Mill product catalogue
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Plans & AI</h1>
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
                <Sparkles className="size-4 text-[#1763de]" />
                Mill Assist
              </p>
              <p className="mt-2 text-sm text-[#747b80]">
                {plan.aiSuggestions
                  ? `${plan.aiSuggestions.toLocaleString("en-US")} reply suggestions / month`
                  : "Optional suggestion packs"}
              </p>
              <p className="mt-1 text-xs text-[#747b80]">
                Available when paid AI launches
              </p>
            </div>
          </section>
        ))}
      </div>
      <section className="grid gap-6 rounded-xl border bg-white p-6 lg:grid-cols-2">
        <div>
          <Sparkles className="size-6 text-[#1763de]" />
          <h2 className="mt-3 text-xl font-semibold">
            A little help. A better reply.
          </h2>
          <p className="mt-2 text-sm text-[#747b80]">
            Mill Assist drafts a reply using the conversation context. Your team
            reviews, edits and sends it.
          </p>
          <p className="mt-4 text-sm font-medium">
            {formatMillPrice(MILL_PRICING.assist.extraPriceCents)} per{" "}
            {MILL_PRICING.assist.extraSuggestions.toLocaleString("en-US")} extra
            suggestions
          </p>
          <p className="mt-2 text-xs text-[#747b80]">
            One generation counts as one suggestion, including regeneration.
            Extra usage requires customer consent.
          </p>
        </div>
        <div className="rounded-lg bg-[#f4f6f8] p-5">
          <span className="rounded border bg-white px-2 py-1 text-xs text-[#747b80]">
            Coming later · pricing proposal
          </span>
          <div className="mt-4 flex items-center gap-2">
            <Bot className="size-5 text-[#1763de]" />
            <h2 className="text-xl font-semibold">Mill AI Agent</h2>
          </div>
          <p className="mt-2 text-sm text-[#747b80]">
            Answers customer questions using your business knowledge and hands
            over to your team when needed.
          </p>
          <p className="mt-4 text-2xl font-semibold">
            {formatMillPrice(MILL_PRICING.agent.monthlyPriceCents)}
            <span className="text-sm font-normal text-[#747b80]"> / month</span>
          </p>
          <p className="mt-2 text-sm">
            {MILL_PRICING.agent.includedResolutions} resolved conversations
            included ·{" "}
            {formatMillPrice(MILL_PRICING.agent.extraResolutionPriceCents)} per
            additional resolution
          </p>
          <p className="mt-3 text-xs text-[#747b80]">
            Not implemented yet. Resolution rules and unit economics must be
            validated before sale. Customer spending limits will control
            additional usage.
          </p>
        </div>
      </section>
      <p className="text-sm text-[#747b80]">
        {MILL_PRICING.trialDays}-day trial without a card. No permanent free
        plan. Human conversations are not billed per message. Annual billing is
        not configured.
      </p>
    </div>
  );
}
