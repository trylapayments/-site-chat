# Site Chat — Visitor Privacy

**Version:** 1.2 (security-hardened)  
**Status:** Foundation  
**Last updated:** 2026-08-19

Related: [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md), [DATA-RETENTION.md](./DATA-RETENTION.md), [SECURITY.md](./SECURITY.md), [WIDGET-STUDIO.md](./WIDGET-STUDIO.md)

---

## 1. Purpose

This document summarizes how Site Chat handles **visitor personal data** collected through the embeddable widget and related APIs. Workspace customers are typically the data controller for their visitors; Site Chat acts as a processor for that messaging and identity data.

This is an engineering architecture note, not legal advice. Customer-facing terms and a DPA are covered under product/legal launch materials.

---

## 2. What we collect (visitor)

| Category | Examples | Notes |
|----------|----------|-------|
| Identity | `name`, `email`, `phone` / `phone_e164` | Provided by unsigned host `identify` (no proof of ownership), widget prompts, or operator edit — see §4a |
| Display id (non-secret) | `contacts.public_id` (`vis_…`) | Random, column `DEFAULT`; **not** a secret, **not** an authorization credential — safe to display/log |
| Continuity credential (secret) | `contacts.continuity_token_hash` | SHA-256 hash of a server-minted opaque token; plaintext returned once, held only in the visitor's browser (widget `localStorage`) — see §4a |
| Custom attributes | Host-supplied primitives in JSONB | Bounded keys/values; reserved keys blocked |
| Session context (redacted URLs) | URL origin + path + allowlisted UTM only, title, referrer, locale, timezone, language | Fragment and non-UTM query params are stripped before storage — see §4b |
| Device class | Parsed browser/OS/device_type | **Not** raw User-Agent string |
| Messaging | Message bodies, attachments metadata | Separate conversation retention rules |
| Public widget presentation | Published colors, layout, localized brand copy, business-hours foundation, logo/launcher/avatar URLs | Workspace-provided presentation, not visitor profile data; see §3a |

**Not collected by default:**

- Raw IP addresses
- Device fingerprints (canvas, audio, WebGL, font enumeration, etc.)
- Precise GPS / geolocation
- Cross-site tracking identifiers outside the workspace widget session

`visitor_sessions.country_code` is reserved for a future **trusted platform header** path only. It must not be populated from IP geolocation in the current identify/page-view design.

---

## 3. Isolation

- Every contact, session, page view, conversation, and **customer timeline** row carries `workspace_id`.
- RLS on `contacts`, `visitor_sessions`, `visitor_page_views`, and `customer_timeline_events` restricts authenticated SELECT to members of that workspace.
- Widget mutations run through service-role RPCs after origin + session validation; clients cannot set `workspace_id` or invent another tenant’s `visitor_id`.
- Email uniqueness is **workspace-local**; unsigned identify enforces it as a write-time conflict only (no cross-contact merge — see §4b).
- Timeline APIs are operator-only (`list_customer_timeline`); visitors/anon cannot execute them. Timeline metadata must not store continuity tokens, auth secrets, signed URLs, or message bodies.

Cross-tenant access attempts must fail in automated RLS tests.

### 3a. Widget Studio brand assets and public bootstrap

Published Widget Studio appearance is intentionally visitor-visible. Bootstrap/config may include typed colors and layout, localized title/subtitle/welcome/placeholder copy, business-hours fields, published version/timestamp, and short-lived signed URLs for a workspace logo, launcher icon, or agent avatar.

These responses do **not** include visitor identity, operator email, workspace members, CRM data, draft copy, raw workspace settings, storage keys, billing, or secrets. Draft state remains available only to authenticated workspace members and is never used by visitor bootstrap.

Brand files are stored in a private workspace-scoped bucket. Publishing an asset reference makes its signed representation visible to visitors on allowed embed origins for the URL lifetime, so customers should treat logos/copy as public and avoid unnecessary personal data. Agent avatars may identify a workspace member and should be uploaded only with an appropriate workplace basis. Original filenames and storage keys are not part of the public DTO.

Site Chat does not fetch arbitrary customer-supplied remote asset URLs. This avoids turning widget bootstrap into a third-party tracking or server-side fetch channel. See [WIDGET-STUDIO.md](./WIDGET-STUDIO.md).

---

## 4. Fingerprinting and tracking stance

Site Chat does **not** implement browser fingerprinting for visitor recognition. Continuity uses:

1. Server-issued session token (opaque, hashed at rest — `visitor_sessions.session_token_hash`)
2. A separate opaque **continuity credential** for resuming the same contact across sessions (§4a)

`public_id` (`vis_…`) is stored in widget storage too, but only for **display** — it is never checked by any resume/bind logic. Host sites remain responsible for their own analytics scripts. Site Chat’s embed must not add canvas/audio fingerprint libraries or third-party trackers for identity.

### 4a. `public_id` vs continuity token

These two client-facing values look similar (both live in widget storage) but serve opposite purposes, and mixing them up would be a security bug:

| | `public_id` | `continuity_token` |
|---|---|---|
| Purpose | Display/correlation label | Cross-session authorization credential |
| Secrecy | Not a secret | Secret — treat like a password/session token |
| Storage at rest | Plaintext (`contacts.public_id`) | **Hashed only** (`contacts.continuity_token_hash`, SHA-256) |
| Can it bind a new session to a contact? | **No, never** | **Yes — the only client-supplied value that can** |
| What if it leaks? | No security impact beyond whatever the id was already visible in | An attacker who obtains the plaintext could resume that visitor's contact on their own session — treat exposure (e.g. via logs, XSS, or a misconfigured proxy) as a credential leak |

Invalid or unrecognized continuity tokens are ignored server-side (a fresh anonymous contact is created), which prevents an attacker from using response differences to enumerate valid tokens.

### 4b. Unsigned identify does not merge by email

The current `SiteChat.identify` API is **unsigned** — the host page asserts an email/name/phone with no cryptographic proof. To prevent a malicious or compromised host page from hijacking another visitor's identity by simply calling `identify({ email: "victim@example.com" })`, unsigned identify:

- Only ever updates the **caller's own current session's contact** — it never searches other contacts by email.
- Never reassigns a session or its conversations to a different, pre-existing contact.
- Rejects (with a generic validation error) attempts to set an email that's already taken by another contact in the workspace, leaving the caller on their own contact.

A future **verified identify** path (server-signed HMAC/JWT assertion) is designed but not implemented; only it will be permitted to perform durable cross-session identity merges. See [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md) §7 and [ADR-003](./adr/ADR-003-visitor-identity-model.md).

---

## 5. IP addresses

**Default:** no raw IP column on `visitor_sessions` or `visitor_page_views`.

Historical design notes that mentioned clear-text IP with a 90-day nulling job are **superseded** for the visitor identity foundation: we intentionally omit raw IP storage. If abuse prevention later requires coarse network signals, that must be a separate, reviewed design (e.g., short-lived hashes or edge rate-limit keys), not silent IP persistence in identity tables.

---

## 6. URL privacy policy

Full page URLs, landing URLs, and referrers frequently carry query-string secrets that a host site didn't intend to leak into a third-party widget (session tokens, one-time links, tracking identifiers, sometimes even auth codes). Site Chat stores a **redacted** form by default, enforced by an allowlist sanitizer applied on every write (both in the shared TypeScript helper and again in the database, for defense in depth):

- **Kept:** origin (`scheme://host[:port]`) + `pathname`, plus only these five query params if present: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`.
- **Stripped:** the URL fragment (`#...`) is discarded entirely before any parsing. Every other query parameter is dropped — this is an **allowlist**, not a blacklist of "known-bad" params.
- Applies uniformly to `visitor_sessions.current_url` / `initial_url` / `landing_url` / `referrer`, every `visitor_page_views.url` / `referrer` row, and widget-sourced `conversations.source_url` / `conversations.referrer` (session create, page-view, message send, attachment initiate/complete).

Because the redaction happens before storage, **the operator dashboard can never display a stripped secret** — there is nothing to accidentally render, export, or leak later. This removes an entire class of "we stored it but forgot to redact it on the way out" bugs.

---

## 7. Lawful basis (high level)

Customers typically rely on one or more of:

- **Legitimate interest** / contractual necessity for operating customer support chat on their site
- **Consent** where required by local law for cookies/storage or marketing use of chat data
- **Legal obligation** for retention or disclosure in limited cases

Site Chat provides technical controls (isolation, export/delete paths, retention settings) so customers can meet their obligations. Exact lawful basis is determined by the customer’s counsel and jurisdiction.

---

## 8. Operator access

| Role | Visitor PII |
|------|-------------|
| Owner / Admin / Agent | View and update visitor profile in conversation context (messaging role for updates) |
| Viewer | Read conversations/contacts per RLS; **cannot** call `update_visitor_profile` |
| Platform service role | Server-only after authorization checks; never in browser bundles |

Operator actions that export contacts should be audit-logged (see SECURITY audit events).

---

## 9. Retention and deletion

Bounded retention for page views, sessions, and contacts is described in [DATA-RETENTION.md](./DATA-RETENTION.md). Split by what exists today versus what's planned:

**Implemented now (schema-enforced, no cron job required):**

- Deleting a `visitor_sessions` row **cascades** to its `visitor_page_views` (`ON DELETE CASCADE`).
- Deleting a `contacts` row sets `contact_id` to `NULL` on its `visitor_page_views` and `conversations` (`ON DELETE SET NULL`) rather than deleting message history.
- Workspace deletion / contact deletion paths are tenant-scoped (filtered by `workspace_id`) in the same way as every other mutation.

**Future work (not yet built):**

- Scheduled purge jobs that actively delete/expire rows older than a retention window (time-based, not just cascade-on-manual-delete).
- Configurable per-workspace retention via `workspaces.settings_json.privacy.visitorDataRetentionDays`.
- Visitor self-service export/delete workflows aligned with GDPR data-subject requests.

Today, "retention" for visitor data is bounded by the cascade/set-null behavior above plus manual owner-initiated deletion — there is no automatic time-based purge yet.

---

## 10. Security of displayed context

Page titles and URLs are attacker-controlled on compromised or malicious host pages. Dashboard UI must treat them as untrusted text (encode on render). Attribute keys/values are validated to reduce prototype pollution and oversized payloads. See [SECURITY.md](./SECURITY.md) visitor identity threats.

---

## Revision History

| Date | Change |
|------|--------|
| 2026-08-19 | Documented Widget Studio published presentation fields, private brand-asset storage, signed visitor delivery, and draft/public boundary |
| 2026-08-11 | Clarified URL privacy also covers conversation `source_url`/`referrer` and send/attachment write paths |
| 2026-08-10 | Security hardening: distinguished `public_id` (non-secret, display-only) from `continuity_token`/`continuity_token_hash` (secret, the real continuity mechanism, hashed at rest); documented that unsigned identify never merges by email; added the URL privacy policy (allowlist sanitizer) section; split retention into implemented cascades vs. future purge jobs |
| 2026-08-10 | Initial visitor privacy doc |
