# AI translation release (not deployed)

The current app does not expose translation until the server returns an enabled capability. Incoming messages can be translated on demand, with source language detected automatically and one of 20 target languages selected by the operator. Reply translation previews the result and only updates the draft after explicit acceptance. Originals are preserved and customer replies are never automatically sent.

## Reviewed behavior

- One shared monthly allowance belongs to the subscription owner account. All companies and operators consume this pool together. Additional sites or operators never multiply it.
- Fresh company permissions and billing authorization run before every cache read.
- Message bodies are resolved using the authenticated operator's RLS client.
- An explicit confirmation precedes sending text to OpenAI. Credentials remain server-only.
- Request identity is independent of its content binding. Ambiguous provider failures retain a reservation and are not automatically resubmitted.
- Owner/company/conversation/source/language/model/prompt version bind cache entries.
- Legacy billing price IDs do not acquire new AI allowances by matching a display name. Proposed versioned catalog IDs need a separate billing release.

## Separate deployment changes requiring approval

1. Apply `20261008181500_account_ai_translation_reservations.sql` after database/security review. **Never apply obsolete-company-reservations.sql.**
2. Integrate three authenticated mobile API operations: `translationCapabilities`, `translateMessage`, `previewReplyTranslation`, using `mobile.ts`. Map `TranslationServiceError` and provider `AIError` to sanitized responses; never emit provider request bodies or secrets.
3. Configure `OPENAI_API_KEY` on the server, `MILL_AI_TRANSLATION_ENABLED=1`, and explicitly approved owner account IDs in `MILL_AI_TRANSLATION_PILOT_ACCOUNT_IDS`. Pilot allowance is 1,000 messages per owner account per UTC month, shared by all companies/operators.
4. For paid accounts, the v2 billing release must write one canonical subscription mapping to `ai_translation_accounts`. Transfer of company ownership never transfers this mapping or paid allowance.
5. Update the privacy policy and store disclosures before submitting the AI-enabled build.

No production migrations, provider flags, billing contracts, or subscription settings have been changed by this patch.
