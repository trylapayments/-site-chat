# Mill iPhone app

The first operator client lives in `apps/mobile`. React Native, Expo SDK 57, Expo Router and strict TypeScript fit the existing pnpm TypeScript monorepo. Android remains possible through the same application, but iOS is the first release target. No billing UI or subscription purchases are included.

## Isolation from parallel portal development

Worktree: `/Users/antonlevy/Documents/Codex/2026-10-06/mill-iphone-mill-live-chat-https/mill-ios`.
Branch: `codex/mill-ios`.
Base: `2ace027`. Snapshot of the original checkout's tracked changes and non-ignored untracked files: `60472fc`. This baseline is context, not part of the proposed mobile change. Do not cherry-pick it into the portal branch. The main checkout was not edited, stashed or reset. Ignored server env was copied privately only to run local checks; mobile env contains public URL/anon key only.

## Implemented client

- Existing Supabase email/password login; session in device Keychain/SecureStore with chunked atomic manifests. Public keys only.
- Workspace switcher, persisted selection, four inbox filters, search and pagination.
- Native conversation UI, older history, unread counters, read receipts and Realtime invalidation with polling reconciliation.
- Resume/reconnect catch-up by sequence, not exclusively by realtime events. Only focused foreground chats are marked read.
- Text and one selected photo/file per message, durable account-scoped outbox, stable `client_message_id`, backoff, manual retry and removal. Local attachment file copied to document storage for interrupted uploads.
- Take, assign/unassign, close/reopen, customer card, existing internal notes, operator status and heartbeat.
- Opt-in Expo push registration, notification response routing including cold start, workspace validation before navigation.

The outbox does not send under a different account. Workspace switching leaves already queued messages bound to their original workspace. Mutation authority comes from the server, not UI hiding. No privileged credentials enter the mobile bundle.

## Backend change set — review before deployment

1. `apps/web/lib/mobile/access.ts`: verifies bearer with Supabase Auth, current workspace membership, capability, existing billing access and active member. Operator RPCs use the user JWT and existing RLS.
2. `apps/web/app/api/v1/mobile/route.ts`: explicit allowlist adapter for existing inbox RPC/query functions, notes, upload services, status and device registration. Bounded body, no-store responses, stable send UUID mandatory. Attachment finalize additionally verifies intent ownership.
3. `apps/web/lib/mobile/database.ts`: proposed mobile tables kept separate from generated database types.
4. `supabase/migrations/20261007090000_mobile_push_outbox.sql`: service-only device registrations and leased push outbox, trigger on existing notifications, unique notification/device pair, bounded claim RPC with `SKIP LOCKED`.
5. `apps/web/lib/mobile/push.ts` and `/api/internal/mobile-push`: server delivery worker using existing notification recipients, quiet hours, current membership and subscription checks. Lock-screen payload omits customer names and message bodies. Expo tickets and delivery receipts are handled separately; invalid device tokens are removed.

No migration was applied, no cloud scheduler was created and no production configuration or web deployment was changed. Integration is not available on `app.mill.chat` until this change set is coordinated with the parallel portal branch. Proposed schema migration still needs an isolated database rollout test.

After review, the server needs `MOBILE_PUSH_CRON_SECRET` (at least 32 random characters), optional `EXPO_ACCESS_TOKEN`, and a scheduler POST to `/api/internal/mobile-push` roughly every minute using its bearer secret. These secrets stay on the server. APNs credentials belong in EAS. Push delivery may be retried after an ambiguous provider timeout; message idempotency is independent of push delivery.

## Running locally with low memory use

Install and build the shared package once from the worktree root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @site-chat/shared build
```

Create `apps/mobile/.env.local` from `.env.example`. For local Simulator use public local Supabase URL and anon key, plus a local web backend containing the mobile adapter. On a physical phone, use a reachable staging HTTPS backend; `127.0.0.1` refers to the phone itself.

Do not run a second full portal or browser preview unless needed. Start only the client while examining it:

```sh
pnpm --filter @mill/mobile preflight
pnpm --filter @mill/mobile start
```

There is no Xcode or iOS Simulator on this Mac at initial inspection. Install Xcode 26.4+ and an iOS runtime to use `pnpm --filter @mill/mobile ios`, or obtain a cloud-built Simulator app through the EAS preview profile. A Simulator itself still needs Xcode on the viewing Mac.

## Cloud builds and TestFlight

`apps/mobile/eas.json` contains Simulator preview, development, physical-device internal and production profiles. Public release configuration must be set as EAS environment variables. `.env.local` and private signing material are excluded from the archive. The preflight hook rejects privileged public variables and localhost/non-HTTPS production endpoints. The post-install hook builds the existing shared package.

The EAS CLI check returned `Not logged in`. From `apps/mobile`:

```sh
npx eas-cli@latest login
npx eas-cli@latest init
```

Record the project UUID as `EXPO_PUBLIC_EAS_PROJECT_ID`; set public Supabase URL, anon/publishable key and the backend URL that contains the reviewed mobile adapter. Confirm the existing/new bundle identifier `chat.mill.operators` with the Apple team before creating the App Store record. Existing Apple Developer membership is sufficient to proceed, but the account login, team selection and credential consent remain user steps.

Simulator preview in cloud:

```sh
npx eas-cli@latest build --platform ios --profile preview
```

After device verification and backend integration:

```sh
node scripts/preflight.mjs --release
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --latest
```

A production build is not yet submitted or signed. App Store Connect needs a matching app record; EAS submit will ask for it and Apple credentials. App review metadata, privacy declarations, a reviewer login/workspace, screenshots from a real iOS build and physical-device QA remain release work.

## Validation and remaining release gates

Completed: iOS Hermes bundle export; mobile and web TypeScript checks; 21/21 Expo Doctor checks; 9 core outbox/routing/transport tests; 10 API authorization tests. Local live smoke confirmed seeded login, history/inbox, subscription refusal, foreign workspace refusal and one stored message after a repeated UUID. A dedicated local `Mill Mobile QA` workspace was created by the existing workspace/trial RPC for those checks. No production mutations.

Browser UI validation used controlled fixtures after local Docker was stopped during the session; login, inbox, chat and queue-send UI passed without browser runtime errors. The output screenshots are viewport previews, not Simulator screenshots or App Store submission assets.

Remaining: native compile/signing and device run; iPhone keyboard, background/process termination, interrupted attachment upload and expiry scenarios; push/APNs end-to-end delivery and receipts; isolated push SQL migration test; precise note pagination beyond the first 50 notes; expired upload intent recovery UX; privacy review of retained offline attachments; workspace-specific push settings and refresh registration after reinstall/token change. Offline cached history after a full process restart is not yet implemented; durable outbox is implemented. These gates must be completed before declaring this release TestFlight-ready.

Official references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native), [Expo Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).
