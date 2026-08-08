# Attachments PR — Test Results

Captured during implementation and CI remediation.

## Vitest

| Package | Result |
|---------|--------|
| `@site-chat/shared` | **75 passed** (12 files) — mime, validate, limits, filename, upload-state, upload-events |
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

Covers: image picker pending state, PDF picker, paste into composer, operator attach control after seeded conversation, upload status ARIA live region.

Existing realtime suite updated for upload status / retry selector specificity (`cross-origin.spec.ts`).

> Latest full suite status is recorded in the PR CI checks for this branch.

## SQL / RLS

Spec: `supabase/tests/database/008_attachments.test.sql`

Covers: table presence, private bucket, cross-tenant SELECT denial, attachment row metadata.

Realtime foundation tests flush deferred broadcast constraints before payload assertions.

## Security review (summary)

See `docs/ATTACHMENTS.md` — signed URLs only, private bucket, magic-byte MIME check, executable/SVG/HTML rejection, sanitized filenames, Content-Disposition `attachment`, antivirus scanner port (stub).
