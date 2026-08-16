import {
  assignContactTagSchema,
  clearContactCustomFieldValueSchema,
  companySchema,
  contactProfileSchema,
  contactTagSchema,
  createCompanySchema,
  createContactTagSchema,
  createCustomFieldDefinitionSchema,
  customFieldDefinitionSchema,
  linkContactCompanySchema,
  listCompaniesQuerySchema,
  listCompaniesResultSchema,
  listContactTagsQuerySchema,
  listContactTagsResultSchema,
  listContactsQuerySchema,
  listContactsResultSchema,
  listCustomFieldDefinitionsResultSchema,
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
  type AssignContactTagInput,
  type ClearContactCustomFieldValueInput,
  type Company,
  type ContactProfile,
  type ContactTag,
  type CreateCompanyInput,
  type CreateContactTagInput,
  type CreateCustomFieldDefinitionInput,
  type CustomFieldDefinition,
  type LinkContactCompanyInput,
  type ListCompaniesQuery,
  type ListCompaniesResult,
  type ListContactTagsQuery,
  type ListContactTagsResult,
  type ListContactsQuery,
  type ListContactsResult,
  type ListCustomFieldDefinitionsResult,
  type SetContactCustomFieldValueInput,
  type SoftDeleteCompanyInput,
  type SoftDeleteContactTagInput,
  type SoftDeleteCustomFieldDefinitionInput,
  type UnassignContactTagInput,
  type UnlinkContactCompanyInput,
  type UpdateCompanyInput,
  type UpdateContactProfileInput,
  type UpdateContactTagInput,
  type UpdateCustomFieldDefinitionInput,
} from "@site-chat/shared";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import {
  callPublicRpc,
  callPublicRpcNullable,
  parseRpcResult,
} from "@/lib/workspace/rpc";

function throwCrmRpcError(error: unknown): never {
  let message: string | null = null;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    const candidate = Reflect.get(error, "message");
    if (typeof candidate === "string") {
      message = candidate;
    }
  }
  const typed = parseCrmErrorMessage(message);
  if (typed) {
    throw typed;
  }
  throw error instanceof Error ? error : new Error("CRM operation failed");
}

export async function fetchContactProfile(
  supabase: AppSupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ContactProfile> {
  const { data, error } = await callPublicRpc(supabase, "get_contact_profile", {
    p_workspace_id: workspaceId,
    p_contact_id: contactId,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactProfileSchema, data, "get_contact_profile");
}

export async function fetchContacts(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListContactsQuery = {},
): Promise<ListContactsResult> {
  const validated = listContactsQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(supabase, "list_contacts", {
    p_workspace_id: workspaceId,
    p_query: validated,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(listContactsResultSchema, data, "list_contacts");
}

export async function updateContactProfile(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UpdateContactProfileInput,
): Promise<ContactProfile> {
  const validated = updateContactProfileSchema.parse(input);
  const { contactId, ...patch } = validated;
  const { data, error } = await callPublicRpc(
    supabase,
    "update_contact_profile",
    {
      p_workspace_id: workspaceId,
      p_contact_id: contactId,
      p_patch: patch,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactProfileSchema, data, "update_contact_profile");
}

export async function fetchContactTags(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListContactTagsQuery = {},
): Promise<ListContactTagsResult> {
  const validated = listContactTagsQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(supabase, "list_contact_tags", {
    p_workspace_id: workspaceId,
    p_query: validated,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(listContactTagsResultSchema, data, "list_contact_tags");
}

export async function createContactTag(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: CreateContactTagInput,
): Promise<ContactTag> {
  const validated = createContactTagSchema.parse(input);
  const { data, error } = await callPublicRpc(supabase, "create_contact_tag", {
    p_workspace_id: workspaceId,
    p_name: validated.name,
    p_color: validated.color,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactTagSchema, data, "create_contact_tag");
}

export async function updateContactTag(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UpdateContactTagInput,
): Promise<ContactTag> {
  const validated = updateContactTagSchema.parse(input);
  const { data, error } = await callPublicRpcNullable(
    supabase,
    "update_contact_tag",
    {
      p_workspace_id: workspaceId,
      p_tag_id: validated.tagId,
      p_name: validated.name ?? null,
      p_color: validated.color ?? null,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactTagSchema, data, "update_contact_tag");
}

export async function softDeleteContactTag(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SoftDeleteContactTagInput,
): Promise<ContactTag> {
  const validated = softDeleteContactTagSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "soft_delete_contact_tag",
    {
      p_workspace_id: workspaceId,
      p_tag_id: validated.tagId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactTagSchema, data, "soft_delete_contact_tag");
}

export async function assignContactTag(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: AssignContactTagInput,
): Promise<ContactProfile> {
  const validated = assignContactTagSchema.parse(input);
  const { data, error } = await callPublicRpc(supabase, "assign_contact_tag", {
    p_workspace_id: workspaceId,
    p_contact_id: validated.contactId,
    p_tag_id: validated.tagId,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactProfileSchema, data, "assign_contact_tag");
}

export async function unassignContactTag(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UnassignContactTagInput,
): Promise<ContactProfile> {
  const validated = unassignContactTagSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "unassign_contact_tag",
    {
      p_workspace_id: workspaceId,
      p_contact_id: validated.contactId,
      p_tag_id: validated.tagId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactProfileSchema, data, "unassign_contact_tag");
}

export async function fetchCompanies(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListCompaniesQuery = {},
): Promise<ListCompaniesResult> {
  const validated = listCompaniesQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(supabase, "list_companies", {
    p_workspace_id: workspaceId,
    p_query: validated,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(listCompaniesResultSchema, data, "list_companies");
}

export async function fetchCompany(
  supabase: AppSupabaseClient,
  workspaceId: string,
  companyId: string,
): Promise<Company> {
  const { data, error } = await callPublicRpc(supabase, "get_company", {
    p_workspace_id: workspaceId,
    p_company_id: companyId,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(companySchema, data, "get_company");
}

export async function createCompany(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: CreateCompanyInput,
): Promise<Company> {
  const validated = createCompanySchema.parse(input);
  const { data, error } = await callPublicRpcNullable(
    supabase,
    "create_company",
    {
      p_workspace_id: workspaceId,
      p_name: validated.name,
      p_domain: validated.domain ?? null,
      p_website: validated.website ?? null,
      p_industry: validated.industry ?? null,
      p_size: validated.size ?? null,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(companySchema, data, "create_company");
}

export async function updateCompany(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UpdateCompanyInput,
): Promise<Company> {
  const validated = updateCompanySchema.parse(input);
  const { companyId, ...patch } = validated;
  const { data, error } = await callPublicRpc(supabase, "update_company", {
    p_workspace_id: workspaceId,
    p_company_id: companyId,
    p_patch: patch,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(companySchema, data, "update_company");
}

export async function softDeleteCompany(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SoftDeleteCompanyInput,
): Promise<Company> {
  const validated = softDeleteCompanySchema.parse(input);
  const { data, error } = await callPublicRpc(supabase, "soft_delete_company", {
    p_workspace_id: workspaceId,
    p_company_id: validated.companyId,
  });

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(companySchema, data, "soft_delete_company");
}

export async function linkContactCompany(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: LinkContactCompanyInput,
): Promise<ContactProfile> {
  const validated = linkContactCompanySchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "link_contact_company",
    {
      p_workspace_id: workspaceId,
      p_contact_id: validated.contactId,
      p_company_id: validated.companyId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactProfileSchema, data, "link_contact_company");
}

export async function unlinkContactCompany(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UnlinkContactCompanyInput,
): Promise<ContactProfile> {
  const validated = unlinkContactCompanySchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "unlink_contact_company",
    {
      p_workspace_id: workspaceId,
      p_contact_id: validated.contactId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(contactProfileSchema, data, "unlink_contact_company");
}

export async function fetchCustomFieldDefinitions(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<ListCustomFieldDefinitionsResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "list_custom_field_definitions",
    {
      p_workspace_id: workspaceId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(
    listCustomFieldDefinitionsResultSchema,
    data,
    "list_custom_field_definitions",
  );
}

export async function createCustomFieldDefinition(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: CreateCustomFieldDefinitionInput,
): Promise<CustomFieldDefinition> {
  const validated = createCustomFieldDefinitionSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "create_custom_field_definition",
    {
      p_workspace_id: workspaceId,
      p_key: validated.key,
      p_label: validated.label,
      p_field_type: validated.field_type,
      p_options_json: validated.options,
      p_sort_order: validated.sort_order,
      p_is_required: validated.is_required,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(
    customFieldDefinitionSchema,
    data,
    "create_custom_field_definition",
  );
}

export async function updateCustomFieldDefinition(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: UpdateCustomFieldDefinitionInput,
): Promise<CustomFieldDefinition> {
  const validated = updateCustomFieldDefinitionSchema.parse(input);
  const { fieldId, ...patch } = validated;
  const { data, error } = await callPublicRpc(
    supabase,
    "update_custom_field_definition",
    {
      p_workspace_id: workspaceId,
      p_field_id: fieldId,
      p_patch: patch,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(
    customFieldDefinitionSchema,
    data,
    "update_custom_field_definition",
  );
}

export async function softDeleteCustomFieldDefinition(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SoftDeleteCustomFieldDefinitionInput,
): Promise<CustomFieldDefinition> {
  const validated = softDeleteCustomFieldDefinitionSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "soft_delete_custom_field_definition",
    {
      p_workspace_id: workspaceId,
      p_field_id: validated.fieldId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(
    customFieldDefinitionSchema,
    data,
    "soft_delete_custom_field_definition",
  );
}

export async function setContactCustomFieldValue(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: SetContactCustomFieldValueInput,
): Promise<ContactProfile> {
  const validated = setContactCustomFieldValueSchema.parse(input);
  const { data, error } = await callPublicRpcNullable(
    supabase,
    "set_contact_custom_field_value",
    {
      p_workspace_id: workspaceId,
      p_contact_id: validated.contactId,
      p_field_id: validated.fieldId,
      p_value: validated.value,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(
    contactProfileSchema,
    data,
    "set_contact_custom_field_value",
  );
}

export async function clearContactCustomFieldValue(
  supabase: AppSupabaseClient,
  workspaceId: string,
  input: ClearContactCustomFieldValueInput,
): Promise<ContactProfile> {
  const validated = clearContactCustomFieldValueSchema.parse(input);
  const { data, error } = await callPublicRpc(
    supabase,
    "clear_contact_custom_field_value",
    {
      p_workspace_id: workspaceId,
      p_contact_id: validated.contactId,
      p_field_id: validated.fieldId,
    },
  );

  if (error) {
    throwCrmRpcError(error);
  }

  return parseRpcResult(
    contactProfileSchema,
    data,
    "clear_contact_custom_field_value",
  );
}
