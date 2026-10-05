# Mill billing

Configure `STRIPE_SECRET_KEY` as a Vercel Secret and
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` as Config in the site-chat-staging project's
Production and Preview environments. Start with matching `sk_test_` / `pk_test_`
keys from the same Stripe account. `STRIPE_BILLING_MODE` defaults to `test`; live
mode requires an explicit `live` value and matching live keys. Deploy after
changing environment variables. A secret key is never sent to the browser.

Only workspace owners/admins can use Billing. Mill displays actual Stripe
subscriptions, invoice history, cards and billing details. A customer is created
on the first card or billing-details action with a server-resolved workspace ID.
Tenant references live in `workspace_billing_accounts`, inaccessible to client
roles; test/live mappings are separate and customer creation is idempotent.

Card entry uses Stripe Elements embedded in Mill. A card-only SetupIntent saves
a payment method without creating a charge or subscription. Stripe.js handles
card authentication; there is no hosted customer-portal redirect. Before making
a saved card default, Mill verifies the successful SetupIntent's customer,
workspace metadata and environment, and verifies the card's customer. Invoice
PDF downloads verify the invoice customer and stay inside Mill. No complete
card numbers/CVC pass through Mill. Server diagnostics record only failure stage
and code, never API keys or card information.

Billing details are explicitly saved to Stripe for future invoices; updating a
Mill company profile does not silently alter invoice data. Existing invoices
are not rewritten. Company renames preserve the workspace URL.

No checkout, paid-plan catalogue or entitlement synchronization is enabled yet.
Agree prices and feature limits before enabling live subscriptions. Webhooks
will be needed when subscription events begin controlling entitlements. Pilot
access is explicitly identified and never presented as a paid or free plan.

## Agreed monthly catalogue

The canonical catalogue is `apps/web/lib/billing/plans.ts`, displayed internally at `/admin/plans`. USD prices per workspace per month, taxes excluded: Starter $29 / 3 operators; Essential $49 / 5; Growth $89 / 10; Business $199 / 20. Starter retains Mill branding; higher tiers allow removal. No permanent Free plan; 14-day trial without card. Annual prices are not configured.

AI is excluded from all chat plans. No included AI allowances or AI prices are approved. Separate AI options and pricing will be defined later, as requested by the user on 2026-10-05.

This catalogue is informational: it does not create Chargebee items/subscriptions, charge customers, or enforce limits. Existing pilot entitlements remain unchanged. Catalogue design and prices were approved by the user on 2026-10-05.
