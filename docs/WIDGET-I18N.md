# Widget Internationalization (i18n)

**Status:** Foundation (PR 4D-1) + typing/presence keys (PR 4D-2)  
**Verified LiveChat language list:** 2026-08-06  
**Source:** [Modify the chat widget language (LiveChat Help)](https://www.livechat.com/help/how-to-modify-chat-window-language/) (article updated Dec 5, 2024)  
**Official language count:** **48**

This document covers **visitor widget interface localization** only. It does **not** cover:

- translating visitor/agent message bodies
- operator dashboard localization
- AI / automatic message translation
- read receipts or notifications

Typing indicators and basic presence chrome keys were added in PR 4D-2 (`agentTyping`, `visitorTyping`, `online`, `offline`).

---

## Translation provenance

Dictionary **key completeness** is enforced by `i18n:check` (every locale has every key; placeholders match English). That is **not** the same as human-certified linguistic quality.

| Source class | Locales |
|--------------|---------|
| Canonical / authored | `en` (source of truth) |
| Prior product copy, reviewed | `ru` (pre-existing widget dictionary, retained/extended; typing/presence keys manually reviewed) |
| Machine-assisted + manual UI review | `he`, `ar`, `fa` (RTL-critical), plus major LTR: `de`, `es`, `fr`, `it`, `pt-PT`, `pt-BR`, `nl`, `pl`, `uk`, `zh-CN`, `zh-TW`, `ja`, `ko` — typing/presence keys included; `he` / `ru` re-checked for natural UI wording |
| Machine-assisted (short UI chrome; needs native-speaker polish) | Remaining registry locales (`hy`, `az`, `bg`, `ca`, `hr`, `cs`, `da`, `et`, `fi`, `ka`, `el`, `hi`, `hu`, `is`, `id`, `kk`, `lv`, `lt`, `mg`, `ms`, `nb`, `nn`, `ro`, `sr`, `sk`, `sl`, `sv`, `th`, `tr`, `vi`) including typing/presence keys |

Do **not** describe machine-assisted dictionaries as “human-complete translations.” Prefer native-speaker review for customer-facing production of lower-resource locales.

Legitimate English loanwords in some locales (`Send`, `Agent`, `System`, `Chat`, `Online`/`Offline`) and brand-preserving `poweredBy` lines that keep “Site Chat” are intentional, not missing translations.

`agentTyping` uses a `{{name}}` placeholder filled with a safe display name when available, otherwise the localized `agentLabel`. Presence strings are intentionally subtle and must not imply an immediate reply.

---

## Supported locales

Canonical BCP 47 codes live in `packages/shared/src/i18n/widget-locales.ts`. Do not scatter locale arrays across packages.

| Code | English name | Native name | Dir |
|------|--------------|-------------|-----|
| `ar` | Arabic | العربية | rtl |
| `hy` | Armenian | Հայերեն | ltr |
| `az` | Azeri | Azərbaycan | ltr |
| `bg` | Bulgarian | Български | ltr |
| `ca` | Catalan | Català | ltr |
| `zh-CN` | Simplified Chinese | 简体中文 | ltr |
| `zh-TW` | Traditional Chinese | 繁體中文 | ltr |
| `hr` | Croatian | Hrvatski | ltr |
| `cs` | Czech | Čeština | ltr |
| `da` | Danish | Dansk | ltr |
| `nl` | Dutch | Nederlands | ltr |
| `en` | English | English | ltr |
| `et` | Estonian | Eesti | ltr |
| `fa` | Farsi/Persian | فارسی | rtl |
| `fi` | Finnish | Suomi | ltr |
| `fr` | French | Français | ltr |
| `ka` | Georgian | ქართული | ltr |
| `de` | German | Deutsch | ltr |
| `el` | Greek | Ελληνικά | ltr |
| `he` | Hebrew | עברית | rtl |
| `hi` | Hindi | हिन्दी | ltr |
| `hu` | Hungarian | Magyar | ltr |
| `is` | Icelandic | Íslenska | ltr |
| `id` | Indonesian | Bahasa Indonesia | ltr |
| `it` | Italian | Italiano | ltr |
| `ja` | Japanese | 日本語 | ltr |
| `kk` | Kazakh | Қазақ тілі | ltr |
| `ko` | Korean | 한국어 | ltr |
| `lv` | Latvian | Latviešu | ltr |
| `lt` | Lithuanian | Lietuvių | ltr |
| `mg` | Malagasy | Malagasy | ltr |
| `ms` | Malaysian | Bahasa Melayu | ltr |
| `nb` | Norwegian (bokmål) | Norsk bokmål | ltr |
| `nn` | Norwegian (nynorsk) | Norsk nynorsk | ltr |
| `pl` | Polish | Polski | ltr |
| `pt-PT` | Portuguese | Português | ltr |
| `pt-BR` | Brazilian Portuguese | Português (Brasil) | ltr |
| `ro` | Romanian | Română | ltr |
| `ru` | Russian | Русский | ltr |
| `sr` | Serbian | Српски | ltr |
| `sk` | Slovak | Slovenčina | ltr |
| `sl` | Slovene | Slovenščina | ltr |
| `es` | Spanish | Español | ltr |
| `sv` | Swedish | Svenska | ltr |
| `th` | Thai | ไทย | ltr |
| `tr` | Turkish | Türkçe | ltr |
| `uk` | Ukrainian | Українська | ltr |
| `vi` | Vietnamese | Tiếng Việt | ltr |

**RTL locales:** `ar`, `fa`, `he`.

**Final fallback:** `en`.

Existing workspace configs using `en` or `ru` continue to work. Hebrew (`he`) can be selected explicitly via `settings_json.widget.locale`.

---

## Locale resolution order

Implemented by `resolveWidgetLocale()` in `packages/shared` (pure, never throws):

1. Explicit workspace/widget locale from bootstrap config (when valid)
2. Explicit embed override (reserved; loader does not yet expose `data-locale`)
3. `navigator.languages` in priority order
4. `navigator.language`
5. English (`en`)

Matching normalizes case and `_` / `-` variants. Examples:

- `en-GB` → `en`
- `pt-BR` → `pt-BR`
- `pt` / `pt-PT` → `pt-PT`
- `zh-CN` / `zh-Hans` → `zh-CN`
- `zh-TW` / `zh-Hant` → `zh-TW`
- `he` / `he-IL` / `iw` → `he`
- `ru` / `ru-RU` → `ru`
- unknown → `en`

Invalid stored locales are normalized to English at the SQL and Zod boundaries. Locale is resolved once per widget session and kept stable.

---

## Dictionary architecture

- Canonical English shape / keys: `packages/widget/src/i18n/types.ts`
- One module per locale: `packages/widget/src/i18n/locales/<code>.ts`
- Lazy loaders: `packages/widget/src/i18n/load-dictionary.ts` (English inlined for fallback; other locales as hashed `/widget/assets/locale-*-*.js` chunks)
- Chunk load failure → English fallback (no remote translation source)

### Translation-key workflow

1. Add the key to `WIDGET_MESSAGE_KEYS` and the English dictionary.
2. Add the same key to every `locales/*.ts` file (or regenerate via `packages/widget/scripts/generate-locale-dictionaries.mjs` and re-apply reviewed copy).
3. Use the key from `messagesCopy` in `WidgetApp` — no hardcoded UI chrome strings.
4. Run `pnpm --filter @site-chat/widget i18n:check`.

Preserve interpolation placeholders exactly (none are required today; the checker enforces parity).

Do not translate brand name **Site Chat** or visitor/agent message bodies. Workspace greeting text is configuration, not dictionary copy.

---

## Date and time

`formatMessageTime(iso, locale)` uses `Intl.DateTimeFormat` with the active canonical locale.

**Timezone policy:** prefer the visitor’s browser timezone (Intl default). Do not reuse the operator Inbox UTC display policy. A workspace timezone override is not configured in this foundation PR. Invalid timestamps return `""`.

---

## RTL and layout

For RTL locales the widget sets `lang` and `dir="rtl"` on the document and root. Message bubbles use logical `flex-start` / `flex-end`. Message bodies and the composer use `dir="auto"` for mixed-script safety. **Launcher/panel position uses physical `left`/`right`** so `bottom-left` / `bottom-right` are not mirrored by RTL.

---

## Completeness gate

```bash
pnpm --filter @site-chat/widget i18n:check
```

CI runs this in the lint/typecheck job. Failures report locale, missing/extra keys, and placeholder mismatches.

---

## How to add a locale

1. Confirm the language is required (extend the LiveChat-aligned registry only with product approval).
2. Add a definition to `WIDGET_LOCALE_DEFINITIONS` (code, names, direction, aliases).
3. Extend `app_private.is_supported_widget_locale` in a new Supabase migration.
4. Add `packages/widget/src/i18n/locales/<code>.ts` and a loader entry.
5. Run `i18n:check`, shared/widget Vitest, and a representative Playwright locale smoke if RTL or CJK.

---

## Bundle strategy

- `loader.js` must not grow materially (no locale dictionaries in the loader).
- English remains in the main `app.js` bundle for first paint / offline fallback.
- Other locales load as same-origin hashed chunks (CSP `script-src 'self'`).
- Measure raw/gzip sizes after `pnpm --filter @site-chat/widget build` and record in the PR.

### Measured sizes (PR 4D-1)

| Asset | Before (raw / gzip) | After (raw / gzip) |
|-------|---------------------|--------------------|
| `loader.js` | 2 718 / 1 216 | 2 718 / 1 216 (unchanged) |
| `app.js` | 495 177 / 138 356 | ~506 KB / ~142 KB (+registry + EN dict + loaders) |
| `assets/locale-*.js` | n/a | 47 chunks, ~0.4–0.6 KB gzip each |

Trade-off: main `app.js` grew modestly for the shared registry and sync English fallback; non-English dictionaries are lazy-loaded and do not inflate `loader.js`.

---

## Configuration contract

Bootstrap `config.locale` is public branding/config data only (no tenant IDs or secrets). Zod (`widgetLocaleInputSchema`) and SQL (`normalize_widget_locale`) accept all 48 canonical codes and fall back to `en` when invalid.
