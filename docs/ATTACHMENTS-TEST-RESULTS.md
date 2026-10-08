# Attachments PR — Test Results

Captured during implementation and CI remediation.

## Vitest

| Package | Result |
|---------|--------|
| `@site-chat/shared` | **76 passed** (12 files) — mime, validate, limits, filename, upload-state, upload-events |
| `@site-chat/widget` | **41 passed** (11 files) |
| `@site-chat/web` | **141 passed** (28 files) — includes `lib/attachments/service.test.ts` |

## i18n

```
pnpm --filter @site-chat/widget i18n:check
→ i18n:check passed (48 locales, 41 keys, RTL: ar, fa, he)
```

## Typecheck / Lint / Build / Database (CI)

| Check | Result |
|-------|--------|
| Lint & Typecheck | pass |
| Build (widget bundle parity) | pass |
| Database (pgTAP + generated types) | pass |

## Playwright (CI)

Spec: `e2e/tests/realtime/attachments.spec.ts`

Covers: image picker pending state, PDF picker, paste into composer, operator attach control after seeded conversation, upload status ARIA live region, visitor→operator image live delivery, operator→visitor image live delivery, visitor PDF downloadable for operator.

Existing realtime suite updated for upload status / retry selector specificity (`cross-origin.spec.ts`).

Merge-readiness follow-up also hardened: operator reconnect catch-up includes attachments, confirmed re-complete is idempotent (no object deletion), Storage SELECT policy removed (signed URLs only), actor-scoped cancel, mid-batch failure cleanup, HTML/SVG-as-text rejection.

| Check | Result |
|-------|--------|
| Lint & Typecheck | pass |
| Build | pass |
| Database | pass |
| Playwright Realtime E2E | **27 passed** |

## SQL / RLS

Spec: `supabase/tests/database/008_attachments.test.sql`

Covers: table presence, private bucket, cross-tenant SELECT denial, attachment row metadata.

Realtime foundation tests flush deferred broadcast constraints before payload assertions.

## Security review (summary)

See `docs/ATTACHMENTS.md` — signed URLs only, private bucket, magic-byte MIME check, executable/SVG/HTML rejection, sanitized filenames, Content-Disposition `attachment`, antivirus scanner port (stub).
