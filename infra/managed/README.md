# Managed deployment: Vercel + Supabase

Staging deployed on 2026-10-03: https://site-chat-staging.vercel.app
Supabase project: `qhdpusswkhshdqkowmft`, North Virginia (`us-east-1`).
Vercel functions: `iad1`, Node 22. All 32 versioned migrations applied.

Verified: HTTPS login, synthetic account sign-in, widget bootstrap/session, visitor
message, private Realtime subscription and operator reply broadcast to the visitor.
Fixed strict workspace creation response validation to accept `widget_public_key`.
Production subscriptions, backup restoration, SMTP and full E2E remain pending.

## Project setup

Import the existing GitHub repository into Vercel with Root Directory `apps/web`.
Enable “Include source files outside of the Root Directory in the Build Step”.
Use Node 22 and the committed `apps/web/vercel.json`. The build runs the root
`pnpm build`: shared and AI packages, fresh widget assets, then Next.js.
Leave the output directory at the Next.js default.

Use independent Vercel and Supabase projects for staging and production. Preview
deployments must receive staging credentials only. Production credentials must
never be shared with E2E runs or arbitrary preview branches.

Choose matching application/database regions after confirming customer location.
Apply versioned SQL migrations to the staging project first; do not run `db reset`
against a hosted database. The development seed is not production initialization.

## Environment and authentication

Configure the variables listed in `.env.example` using each platform's secret UI.
Set the public app URL to the exact hosted HTTPS origin. Generate independent
cookie, widget and rate-limit secrets for each environment. Never copy local
Supabase keys into hosted projects.

The widget currently mints HS256 JWTs using `SUPABASE_JWT_SECRET` with the custom
`widget_realtime` database role. Before deployment, prove the hosted project accepts
these scoped tokens and enforces its Realtime RLS policies. Do not revoke the
legacy signing secret until this dependency has been migrated and tested.
The API key and JWT signing key are different credentials.

Configure exact auth callback and recovery URLs, production SMTP delivery, and
Millcorn's exact allowed parent origins. Keep mock AI disabled in production.

## Release requirements

- Green CI including database tests and all relevant E2E scenarios, with no
  production credentials. Local browser E2E remain unverified because the
  macOS sandbox prevents Chromium from launching.
- Hosted staging checks: sign-in, reset password, cross-origin widget,
  visitor/operator messages in both directions, reconnect, attachments,
  assignment, canned responses, team access, CRM, AI and tenant isolation.
- Inspect deployed client assets for server secrets and localhost URLs.
- Verify backup restoration into an isolated project, including custom database
  roles, grants and object files; document recovery time and data loss window.
- Set external availability checks and notification routing; alert on API errors,
  Realtime failures, database/storage capacity and spend.
- Promote a known staging-tested revision. Confirm rollback before installing the
  production widget on Millcorn. Prefer backward-compatible database migrations;
  rolling back the web deployment does not roll back SQL migrations.

## Backups and operating costs

Supabase Pro starts at $25/month including compute credit for one Micro project
and seven days of daily database backups. Storage API objects are excluded from
database backups: attachments and brand assets need separate off-site copies and
a restore test. Daily backups can lose changes since the last backup; assess PITR
separately when a smaller recovery window is required.

Vercel Pro starts at $20/month. Starting production base is therefore $45/month
for one paid developer seat and one Micro Supabase project. An additional Micro
staging project in the paid organization adds approximately $10/month: $55 base.
Taxes, usage overages, AI, SMTP, off-site backups and monitoring may add charges.
These amounts are estimates, not a hard spending cap or an uptime guarantee.
Do not configure automatic production shutdown as a cost control without weighing
the availability impact. Production deployment and paid subscriptions remain pending.

Sources checked 2026-10-03:

- https://vercel.com/pricing
- https://vercel.com/docs/monorepos/monorepo-faq
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/auth/signing-keys
