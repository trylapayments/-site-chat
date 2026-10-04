# Mill authentication emails

Supabase Auth sends registration confirmation and password recovery through
Resend SMTP. Operator notification delivery uses a separate outbox worker; its
cron is not involved in authentication emails.

## Configuration

The independent staging project uses:

- SMTP host `smtp.resend.com`, TLS port `465`, username `resend`.
- Sender `Mill <notifications@notify.mill.chat>`.
- A sending-only Resend key restricted to the verified `notify.mill.chat`
  domain, saved as the protected SMTP password in Supabase Auth.
- Email confirmation enabled. Retain existing session, JWT and signup settings.
- The staging application origin `https://site-chat-staging.vercel.app` with
  exact `/auth/callback` and `/auth/recovery` redirect destinations.
- A 60-second minimum interval per user. Enabling custom SMTP sets Supabase's
  initial email rate limit to 30 per hour; capacity must be reviewed before a
  public launch.

Update only SMTP, subjects and email templates in the Supabase dashboard. Do
not push the local `config.toml` to the hosted project: local URLs and other
local service settings are not the hosted configuration. No provider keys or
one-time links belong in committed files, logs or screenshots.

The canonical English templates are:

- `supabase/templates/confirmation.html`: **Confirm your Mill account**.
- `supabase/templates/recovery.html`: **Reset your Mill password**.

Local Supabase uses these same templates through `config.toml` and delivers to
Inbucket. It does not send local test messages through the real provider. When
editing the hosted code editor, replace its entire document and verify the
saved content after reload; filling its backing textarea can append content.

## Application flow

Registration invokes Supabase `signUp` with `/auth/callback`. The email's
`ConfirmationURL` verifies the one-time token and returns a PKCE code. The
callback exchanges it using the initiating client's verifier cookie and routes
the confirmed user to onboarding or their workspace.

Password recovery invokes `resetPasswordForEmail` with `/auth/recovery`. After
the successful exchange, the route verifies recovery claims and creates the
signed `sc_recovery` cookie bound to the session. The password form requires
that authenticated session and valid cookie. Successful update clears the
recovery cookie and returns to `/app`.

Links are single-use. PKCE requires the initiating browser's verifier cookie;
opening a link in another browser/device is not currently covered by this
flow. Use the same browser that requested the email. Do not weaken the gate to
accept any logged-in session as a recovery session.

## Verification completed on 4 October 2026

A real public signup for the explicitly approved test address was initially
unconfirmed. Resend delivered the branded confirmation email. Consuming its
actual link through the application callback confirmed the account, redirected
to `/app/onboarding`, and allowed a fresh password login.

Resend also delivered the branded recovery email for the prior isolated test
operator. Its actual link opened `/reset-password`; submitting the application
form returned to `/app`. The original password was rejected, the temporary new
password allowed a fresh login, and the original test password was restored
through the authenticated test session afterward. Replaying the callback went
to `/auth-error`; unauthenticated `/reset-password` went to `/forgot-password`.
All 280 web unit/integration tests passed, including recovery gate, cookie and
callback tests. No manual database edits, confirmation bypass or admin password
reset was used.

Sources: [Resend Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp),
[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates),
[Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
