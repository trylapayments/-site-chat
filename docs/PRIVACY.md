# Site Chat — Visitor Privacy

**Version:** 1.0  
**Status:** Foundation  
**Last updated:** 2026-08-10

Related: [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md), [DATA-RETENTION.md](./DATA-RETENTION.md), [SECURITY.md](./SECURITY.md)

---

## 1. Purpose

This document summarizes how Site Chat handles **visitor personal data** collected through the embeddable widget and related APIs. Workspace customers are typically the data controller for their visitors; Site Chat acts as a processor for that messaging and identity data.

This is an engineering architecture note, not legal advice. Customer-facing terms and a DPA are covered under product/legal launch materials.

---

## 2. What we collect (visitor)

| Category | Examples | Notes |
|----------|----------|-------|
| Identity | `name`, `email`, `phone` / `phone_e164` | Provided by host `identify`, widget prompts, or operator edit |
| Opaque id | `contacts.public_id` (`vis_…`) | Random; not derived from PII |
| Custom attributes | Host-supplied primitives in JSONB | Bounded keys/values; reserved keys blocked |
| Session context | URL, title, referrer, UTM, locale, timezone, language | From page/session; length-bounded |
| Device class | Parsed browser/OS/device_type | **Not** raw User-Agent string |
| Messaging | Message bodies, attachments metadata | Separate conversation retention rules |

**Not collected by default:**

- Raw IP addresses
- Device fingerprints (canvas, audio, WebGL, font enumeration, etc.)
- Precise GPS / geolocation
- Cross-site tracking identifiers outside the workspace widget session

`visitor_sessions.country_code` is reserved for a future **trusted platform header** path only. It must not be populated from IP geolocation in the current identify/page-view design.

---

## 3. Isolation

- Every contact, session, page view, and conversation row carries `workspace_id`.
- RLS on `contacts`, `visitor_sessions`, and `visitor_page_views` restricts authenticated SELECT to members of that workspace.
- Widget mutations run through service-role RPCs after origin + session validation; clients cannot set `workspace_id` or invent another tenant’s `visitor_id`.
- Email uniqueness and identify merges are **workspace-local**.

Cross-tenant access attempts must fail in automated RLS tests.

---

## 4. Fingerprinting and tracking stance

Site Chat does **not** implement browser fingerprinting for visitor recognition. Continuity uses:

1. Server-issued session token (hashed at rest)
2. Optional durable `public_id` stored in widget storage and presented on init

Host sites remain responsible for their own analytics scripts. Site Chat’s embed must not add canvas/audio fingerprint libraries or third-party trackers for identity.

---

## 5. IP addresses

**Default:** no raw IP column on `visitor_sessions` or `visitor_page_views`.

Historical design notes that mentioned clear-text IP with a 90-day nulling job are **superseded** for the visitor identity foundation: we intentionally omit raw IP storage. If abuse prevention later requires coarse network signals, that must be a separate, reviewed design (e.g., short-lived hashes or edge rate-limit keys), not silent IP persistence in identity tables.

---

## 6. Lawful basis (high level)

Customers typically rely on one or more of:

- **Legitimate interest** / contractual necessity for operating customer support chat on their site
- **Consent** where required by local law for cookies/storage or marketing use of chat data
- **Legal obligation** for retention or disclosure in limited cases

Site Chat provides technical controls (isolation, export/delete paths, retention settings) so customers can meet their obligations. Exact lawful basis is determined by the customer’s counsel and jurisdiction.

---

## 7. Operator access

| Role | Visitor PII |
|------|-------------|
| Owner / Admin / Agent | View and update visitor profile in conversation context (messaging role for updates) |
| Viewer | Read conversations/contacts per RLS; **cannot** call `update_visitor_profile` |
| Platform service role | Server-only after authorization checks; never in browser bundles |

Operator actions that export contacts should be audit-logged (see SECURITY audit events).

---

## 8. Retention and deletion

Bounded retention for page views, sessions, and contacts is described in [DATA-RETENTION.md](./DATA-RETENTION.md).

Pointers:

- Configurable retention later: `workspaces.settings_json.privacy.visitorDataRetentionDays`
- Purge jobs are **future** work; architecture documents cascade behavior now
- Workspace deletion / contact deletion paths must remain tenant-scoped

---

## 9. Security of displayed context

Page titles and URLs are attacker-controlled on compromised or malicious host pages. Dashboard UI must treat them as untrusted text (encode on render). Attribute keys/values are validated to reduce prototype pollution and oversized payloads. See [SECURITY.md](./SECURITY.md) visitor identity threats.

---

## Revision History

| Date | Change |
|------|--------|
| 2026-08-10 | Initial visitor privacy doc |
