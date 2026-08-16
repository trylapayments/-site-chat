"use server";

import {
  assignContactTagSchema,
  clearContactCustomFieldValueSchema,
  createCompanySchema,
  createContactTagSchema,
  createCustomFieldDefinitionSchema,
  CrmError,
  linkContactCompanySchema,
  listCompaniesQuerySchema,
  listContactTagsQuerySchema,
  listContactsQuerySchema,
  parseCrmErrorMessage,
  setContactCustomFieldValueSchema,
  softDeleteCompanySchema,
  softDeleteContactTagSchema,
  softDeleteCustomFieldDefinitionSchema,
  unassignContactTagSchema,
  unlinkContactCompanySchema,
  updateCompanySchema,
  updateContactProfileSchema,
  updateContactTagSchema,
  updateCustomFieldDefinitionSchema,
  type Company,
  type ContactProfile,
  type ContactTag,
  type CustomFieldDefinition,
  type ListCompaniesResult,
  type ListContactTagsResult,
  type ListContactsResult,
  type ListCustomFieldDefinitionsResult,
} from "@site-chat/shared";
import { revalidatePath } from "next/cache";

import { requireCrmWorkspace } from "@/lib/crm/guards";
import {
  assignContactTag,
  clearContactCustomFieldValue,
  createCompany,
  createContactTag,
  createCustomFieldDefinition,
  fetchCompanies,
  fetchContactProfile,
  fetchContactTags,
  fetchContacts,
  fetchCustomFieldDefinitions,
  linkContactCompany,
  setContactCustomFieldValue,
  softDeleteCompany,
  softDeleteContactTag,
  softDeleteCustomFieldDefinition,
  unassignContactTag,
  unlinkContactCompany,
  updateCompany,
  updateContactProfile,
  updateContactTag,
  updateCustomFieldDefinition,
} from "@/lib/crm/queries";
import {
  SETTINGS_SECTION_CRM,
  workspaceContactsPath,
  workspaceNavPath,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";

export type CrmActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string };

function mapCrmActionError<T>(
  error: unknown,
  fallback: string,
): CrmActionResult<T> {
  if (error instanceof CapabilityError) {
    return { success: false, message: error.message, code: "FORBIDDEN" };
  }
  if (error instanceof CrmError) {
    return { success: false, message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    const typed = parseCrmErrorMessage(error.message);
    if (typed) {
      return { success: false, message: typed.message, code: typed.code };
    }
  }
  return { success: false, message: fallback };
}

async function requireCrmContext(workspaceSlug: string) {
  const { workspace } = await requireCrmWorkspace(workspaceSlug);
  const supabase = await createClient();
  return { workspace, supabase };
}

function revalidateCrmPaths(workspaceSlug: string, contactId?: string): void {
  revalidatePath(workspaceNavPath(workspaceSlug, "contacts"), "layout");
  revalidatePath(workspaceSettingsPath(workspaceSlug, SETTINGS_SECTION_CRM));
  revalidatePath(workspaceNavPath(workspaceSlug, "inbox"), "layout");
  if (contactId) {
    revalidatePath(workspaceContactsPath(workspaceSlug, contactId));
  }
}

export async function listContactsAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<CrmActionResult<ListContactsResult>> {
  try {
    const parsed = listContactsQuerySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid contacts query." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "view_contact_profile");

    const data = await fetchContacts(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to load contacts.");
  }
}

export async function getContactProfileAction(
  workspaceSlug: string,
  contactId: string,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "view_contact_profile");

    const data = await fetchContactProfile(
      supabase,
      workspace.workspace_id,
      contactId,
    );
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to load contact profile.");
  }
}

export async function updateContactProfileAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = updateContactProfileSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid profile update.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await updateContactProfile(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to update contact profile.");
  }
}

export async function listContactTagsAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<CrmActionResult<ListContactTagsResult>> {
  try {
    const parsed = listContactTagsQuerySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid tags query." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "view_contact_profile");

    const data = await fetchContactTags(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to load tags.");
  }
}

export async function createContactTagAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactTag>> {
  try {
    const parsed = createContactTagSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid tag.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await createContactTag(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to create tag.");
  }
}

export async function updateContactTagAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactTag>> {
  try {
    const parsed = updateContactTagSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid tag update.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await updateContactTag(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to update tag.");
  }
}

export async function softDeleteContactTagAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactTag>> {
  try {
    const parsed = softDeleteContactTagSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid tag id." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await softDeleteContactTag(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to delete tag.");
  }
}

export async function assignContactTagAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = assignContactTagSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid tag assignment." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await assignContactTag(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to assign tag.");
  }
}

export async function unassignContactTagAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = unassignContactTagSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid tag removal." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await unassignContactTag(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to remove tag.");
  }
}

export async function listCompaniesAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<CrmActionResult<ListCompaniesResult>> {
  try {
    const parsed = listCompaniesQuerySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid companies query." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "view_contact_profile");

    const data = await fetchCompanies(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to load companies.");
  }
}

export async function createCompanyAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<Company>> {
  try {
    const parsed = createCompanySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid company.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await createCompany(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to create company.");
  }
}

export async function updateCompanyAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<Company>> {
  try {
    const parsed = updateCompanySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid company update.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await updateCompany(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to update company.");
  }
}

export async function softDeleteCompanyAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<Company>> {
  try {
    const parsed = softDeleteCompanySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid company id." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await softDeleteCompany(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to delete company.");
  }
}

export async function linkContactCompanyAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = linkContactCompanySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid company link." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await linkContactCompany(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to link company.");
  }
}

export async function unlinkContactCompanyAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = unlinkContactCompanySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid company unlink." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await unlinkContactCompany(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to unlink company.");
  }
}

export async function listCustomFieldDefinitionsAction(
  workspaceSlug: string,
): Promise<CrmActionResult<ListCustomFieldDefinitionsResult>> {
  try {
    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "view_contact_profile");

    const data = await fetchCustomFieldDefinitions(
      supabase,
      workspace.workspace_id,
    );
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to load custom fields.");
  }
}

export async function createCustomFieldDefinitionAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<CustomFieldDefinition>> {
  try {
    const parsed = createCustomFieldDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid custom field.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "manage_crm_definitions");

    const data = await createCustomFieldDefinition(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to create custom field.");
  }
}

export async function updateCustomFieldDefinitionAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<CustomFieldDefinition>> {
  try {
    const parsed = updateCustomFieldDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message:
          parsed.error.issues[0]?.message ?? "Invalid custom field update.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "manage_crm_definitions");

    const data = await updateCustomFieldDefinition(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to update custom field.");
  }
}

export async function softDeleteCustomFieldDefinitionAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<CustomFieldDefinition>> {
  try {
    const parsed = softDeleteCustomFieldDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid custom field id." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "manage_crm_definitions");

    const data = await softDeleteCustomFieldDefinition(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to delete custom field.");
  }
}

export async function setContactCustomFieldValueAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = setContactCustomFieldValueSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid field value.",
      };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await setContactCustomFieldValue(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to save custom field value.");
  }
}

export async function clearContactCustomFieldValueAction(
  workspaceSlug: string,
  input: unknown,
): Promise<CrmActionResult<ContactProfile>> {
  try {
    const parsed = clearContactCustomFieldValueSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid field clear request." };
    }

    const { workspace, supabase } = await requireCrmContext(workspaceSlug);
    requireCapability(workspace.role, "update_visitor_profile");

    const data = await clearContactCustomFieldValue(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateCrmPaths(workspaceSlug, parsed.data.contactId);
    return { success: true, data };
  } catch (error) {
    return mapCrmActionError(error, "Unable to clear custom field value.");
  }
}
