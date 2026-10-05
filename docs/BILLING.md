# Mill billing

Stripe is server-only. Configure `STRIPE_SECRET_KEY` as a Vercel Secret in the
site-chat-staging project's Production and Preview environments. Start with a
`sk_test_` key. `STRIPE_BILLING_MODE` defaults to `test`; live mode requires an
explicit `live` value and matching live key. A deployment is required after
changing environment variables. No publishable key is required by this portal.

The workspace owner/admin can open Billing. A customer is created on the first
Manage billing action using a server-resolved workspace ID. Tenant/customer
references live in `workspace_billing_accounts`, inaccessible to client roles.
Test and live mappings are separate. Creation uses an idempotency key.

Mill lists actual Stripe subscriptions, invoices and payment methods, and opens
a Stripe-hosted portal for payment and invoice details. Complete card data never
passes through Mill. The portal configuration is created once per mode or can
be supplied with `STRIPE_PORTAL_CONFIGURATION_ID`.

No checkout, paid-plan catalogue or entitlement synchronization is enabled yet.
Agree prices and paid-plan feature limits before enabling live subscriptions.
Webhook handling will be needed when subscription events begin controlling
entitlements. Pilot grants are explicitly shown as pilot access and never
represented as a paid or free subscription.

Company settings control Mill workspace display name and business profile. The
workspace URL is stable across renames. Invoice business details are managed
separately in the Stripe portal; editing a Mill company profile does not silently
rewrite existing invoices or Stripe customer data.
