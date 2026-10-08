/**
 * Dirty-only identity patches and draft-preserving live reconcile for CRM forms.
 *
 * Omitted keys mean "do not change". Empty string normalizes to null (clear).
 */

export const CONTACT_IDENTITY_KEYS = [
  "name",
  "email",
  "phone",
  "job_title",
  "locale",
  "country_code",
] as const;

export type ContactIdentityKey = (typeof CONTACT_IDENTITY_KEYS)[number];

export const VISITOR_IDENTITY_KEYS = ["name", "email", "phone"] as const;

export type VisitorIdentityKey = (typeof VISITOR_IDENTITY_KEYS)[number];

export type ContactIdentityValues = {
  [K in ContactIdentityKey]: string | null;
};

export type ContactIdentityDraft = {
  [K in ContactIdentityKey]: string;
};

export type VisitorIdentityValues = {
  [K in VisitorIdentityKey]: string | null;
};

export type VisitorIdentityDraft = {
  [K in VisitorIdentityKey]: string;
};

/** Normalize a form/server identity field for equality and patch payloads. */
export function normalizeIdentityFieldValue(
  key: ContactIdentityKey | VisitorIdentityKey,
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (key === "country_code") {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

export function identityValuesToDraft<K extends string>(
  keys: readonly K[],
  values: Record<K, string | null | undefined>,
): { [P in K]: string } {
  const draft = {} as { [P in K]: string };
  for (const key of keys) {
    draft[key] = values[key] ?? "";
  }
  return draft;
}

export function identityValuesFromProfile(
  profile: Partial<ContactIdentityValues> | null | undefined,
): ContactIdentityValues {
  return {
    name: profile?.name ?? null,
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    job_title: profile?.job_title ?? null,
    locale: profile?.locale ?? null,
    country_code: profile?.country_code ?? null,
  };
}

export type ContactIdentityPatch = {
  contactId: string;
} & Partial<ContactIdentityValues>;

/**
 * Build an update_contact_profile patch with only fields that differ from baseline.
 * Empty draft strings become null (clear). Keys that match baseline are omitted.
 */
export function buildContactIdentityPatch(input: {
  contactId: string;
  baseline: ContactIdentityValues;
  draft: ContactIdentityDraft | ContactIdentityValues;
}): ContactIdentityPatch {
  const patch: ContactIdentityPatch = { contactId: input.contactId };

  for (const key of CONTACT_IDENTITY_KEYS) {
    const next = normalizeIdentityFieldValue(key, input.draft[key]);
    const prev = normalizeIdentityFieldValue(key, input.baseline[key]);
    if (next !== prev) {
      patch[key] = next;
    }
  }

  return patch;
}

export function contactIdentityPatchHasChanges(patch: ContactIdentityPatch): boolean {
  return CONTACT_IDENTITY_KEYS.some((key) => patch[key] !== undefined);
}

export type VisitorIdentityPatch = Partial<VisitorIdentityValues>;

/**
 * Build a visitor/sidebar identity patch with only dirty name/email/phone fields.
 */
export function buildVisitorIdentityPatch(input: {
  baseline: VisitorIdentityValues;
  draft: VisitorIdentityDraft | VisitorIdentityValues;
}): VisitorIdentityPatch {
  const patch: VisitorIdentityPatch = {};

  for (const key of VISITOR_IDENTITY_KEYS) {
    const next = normalizeIdentityFieldValue(key, input.draft[key]);
    const prev = normalizeIdentityFieldValue(key, input.baseline[key]);
    if (next !== prev) {
      patch[key] = next;
    }
  }

  return patch;
}

export function visitorIdentityPatchHasChanges(patch: VisitorIdentityPatch): boolean {
  return VISITOR_IDENTITY_KEYS.some((key) => patch[key] !== undefined);
}

/**
 * Reconcile local draft with a newer server snapshot.
 * - Pristine fields (draft equals previous baseline) adopt the server value.
 * - Dirty fields keep the local draft.
 * - Baseline always becomes the server snapshot.
 */
export function reconcileIdentityDraft<K extends ContactIdentityKey | VisitorIdentityKey>(input: {
  keys: readonly K[];
  baseline: Record<K, string | null>;
  draft: Record<K, string>;
  server: Partial<Record<K, string | null | undefined>>;
}): {
  baseline: Record<K, string | null>;
  draft: Record<K, string>;
} {
  const nextBaseline = { ...input.baseline };
  const nextDraft = { ...input.draft };

  for (const key of input.keys) {
    const serverValue = input.server[key] ?? null;
    const draftNorm = normalizeIdentityFieldValue(key, input.draft[key]);
    const baselineNorm = normalizeIdentityFieldValue(key, input.baseline[key]);
    const isPristine = draftNorm === baselineNorm;

    nextBaseline[key] = serverValue;
    if (isPristine) {
      nextDraft[key] = serverValue ?? "";
    }
  }

  return { baseline: nextBaseline, draft: nextDraft };
}

export function reconcileContactIdentityDraft(input: {
  baseline: ContactIdentityValues;
  draft: ContactIdentityDraft;
  server: Partial<ContactIdentityValues>;
}): {
  baseline: ContactIdentityValues;
  draft: ContactIdentityDraft;
} {
  return reconcileIdentityDraft({
    keys: CONTACT_IDENTITY_KEYS,
    baseline: input.baseline,
    draft: input.draft,
    server: input.server,
  });
}

export function reconcileVisitorIdentityDraft(input: {
  baseline: VisitorIdentityValues;
  draft: VisitorIdentityDraft;
  server: Partial<VisitorIdentityValues>;
}): {
  baseline: VisitorIdentityValues;
  draft: VisitorIdentityDraft;
} {
  return reconcileIdentityDraft({
    keys: VISITOR_IDENTITY_KEYS,
    baseline: input.baseline,
    draft: input.draft,
    server: input.server,
  });
}
