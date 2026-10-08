# Mill platform administration

The internal console is `/admin/customers`. It is separate from customer workspace roles. Access requires a confirmed authenticated account and an enabled row in `platform_administrators`; tenant ownership alone does not grant access.

## Roles

- Owner: company, access, trial, suspension, domains, customer team, notes, billing visibility and platform team administration.
- Support: customer visibility, notes and local trial administration.
- Finance: customer and billing visibility; no account mutation.
- Viewer: customer visibility; no mutations or payment-method visibility.

Every company mutation requires an audit reason and the current control version. The database locks the workspace and commits the change and audit record atomically. Stale changes fail rather than overwrite another administrator. The last active customer owner and last enabled platform owner are protected. Platform team changes require an existing owner and a confirmed Mill account.

Tables and mutation/statistics functions are inaccessible to anonymous and normal authenticated database roles. Only the server service role invokes them after verified platform authorization; database functions independently check the acting administrator.

## Implemented

Customer search and pagination; company profile; full-feature pilot and feature overrides with expiry; local trials; suspension and restoration; customer membership roles/status; allowed domains; internal notes; before/after audit history; basic conversation counters; platform staff permissions. Chargebee accounts, subscriptions, invoices and payment sources are displayed when connected.

Local trial expiry blocks widget access. Millcorn retains its existing full-feature pilot. Overrides apply to implemented widget features. Changing customer/company records does not silently change the payment provider's customer profile.

## Remaining billing work

Numeric limits are stored allowances and are explicitly marked unenforced. AI/storage metering is not available yet. Chargebee trial and subscription changes, plan catalogue editing, invoice/payment mutations, automatic dunning/access reconciliation and customer support tickets require further implementation. Connected Chargebee trials cannot be changed through the local trial action.

## Focused verification

Database permission/transaction tests: `supabase/tests/database/032_platform_administration.test.sql`.
Server guard/schema tests: `apps/web/lib/platform-admin/*.test.ts`.
Local browser scenario: `e2e/tests/inbox/platform-admin.spec.ts` (fixture is restricted to local Supabase and restores platform permission state).
