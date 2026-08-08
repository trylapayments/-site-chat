# Attachments PR — Test Results

Captured during implementation (local agent environment).

## Vitest

| Package | Result |
|---------|--------|
| `@site-chat/shared` | **75 passed** (12 files) — includes mime, validate, limits, filename, upload-state, upload-events |
| `@site-chat/widget` | **41 passed** (11 files) |
| `@site-chat/web` | **141 passed** (28 files) — includes `lib/attachments/service.test.ts` |

## i18n

```
pnpm --filter @site-chat/widget i18n:check
→ i18n:check passed (48 locales, 41 keys, RTL: ar, fa, he)
```

## Typecheck / Lint

| Check | Result |
|-------|--------|
| `pnpm --filter @site-chat/shared build` | pass |
| `pnpm --filter @site-chat/widget typecheck` | pass |
| `pnpm --filter @site-chat/web typecheck` | pass |
| `pnpm --filter @site-chat/widget lint` | pass |
| `pnpm --filter @site-chat/web lint` | pass |

## Playwright

Spec added: `e2e/tests/realtime/attachments.spec.ts`

Covers: file picker pending state, paste into composer, operator attach control presence, upload status ARIA live region.

> Full upload→realtime e2e (image/PDF/DnD/retry/cancel/offline/cross-party delivery) requires Supabase Storage + running stack in CI. Spec is wired for CI `pnpm test:e2e`.

## SQL / RLS

Spec added: `supabase/tests/database/008_attachments.test.sql`

Covers: table presence, private bucket, cross-tenant SELECT denial, attachment row metadata.

## Security review (summary)

See `docs/ATTACHMENTS.md` — signed URLs only, private bucket, magic-byte MIME check, executable/SVG/HTML rejection, sanitized filenames, Content-Disposition `attachment`, antivirus scanner port (stub).
