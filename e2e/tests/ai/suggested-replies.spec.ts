import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import {
  ADMIN_EMAIL,
  APP_URL,
  OPERATOR_PASSWORD,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
  VIEWER_EMAIL,
  WORKSPACE_SLUG,
  loginAs,
  loginOperator,
  openOperatorConversation,
  openWidget,
  operatorReplyComposer,
  sendWidgetMessage,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
} from "../../helpers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} for AI E2E helper`);
  }
  return value;
}

function serviceRoleClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

function anonClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function getAcmeWorkspaceId(): Promise<string> {
  const supabase = serviceRoleClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", WORKSPACE_SLUG)
    .single();
  if (error || !data) {
    throw error ?? new Error("Acme workspace not found");
  }
  return data.id;
}

/**
 * Create a real workspace owned by admin@local.test (not owner@local.test).
 * Uses the authenticated create_workspace RPC — service_role cannot INSERT workspaces.
 */
async function createForeignWorkspaceOwnedByAdmin(): Promise<string> {
  const supabase = anonClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: OPERATOR_PASSWORD,
  });
  if (signInError) {
    throw signInError;
  }

  const slug = `other-ai-${Date.now()}`;
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: "Other AI Workspace",
    p_slug: slug,
  });
  await supabase.auth.signOut();

  if (error) {
    throw error;
  }

  const workspaceId =
    data && typeof data === "object" && "workspace_id" in data
      ? String((data as { workspace_id: string }).workspace_id)
      : null;
  if (!workspaceId) {
    throw new Error("create_workspace did not return workspace_id");
  }
  return workspaceId;
}

/** Resolve a seeded conversation id from the inbox UI (no conversations table grant for service_role). */
async function resolveSeededConversationId(
  page: Page,
): Promise<{ workspaceId: string; conversationId: string }> {
  const workspaceId = await getAcmeWorkspaceId();
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
  await openOperatorConversation(page, SEEDED_OPEN_CONVERSATION_PREVIEW);
  const match = page.url().match(/\/inbox\/([0-9a-f-]{36})/i);
  if (!match?.[1]) {
    throw new Error(`Could not parse conversation id from URL: ${page.url()}`);
  }
  return { workspaceId, conversationId: match[1] };
}

async function setWorkspaceAiEnabled(enabled: boolean) {
  const supabase = serviceRoleClient();

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, settings_json")
    .eq("slug", WORKSPACE_SLUG)
    .single();

  if (workspaceError || !workspace) {
    throw workspaceError ?? new Error("Workspace not found");
  }

  const settings =
    workspace.settings_json && typeof workspace.settings_json === "object"
      ? (workspace.settings_json as Record<string, unknown>)
      : {};

  const nextSettings = {
    ...settings,
    ai: {
      enabled,
      provider: "mock",
      model: "mock-suggested-reply",
      features: {
        suggestedReplies: enabled,
        summary: false,
        rag: false,
        agent: false,
      },
    },
  };

  const { error } = await supabase
    .from("workspaces")
    .update({ settings_json: nextSettings })
    .eq("id", workspace.id);

  if (error) {
    throw error;
  }
}

async function openSeededConversation(page: Page, previewText: string) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
  await openOperatorConversation(page, previewText);
  await waitForOperatorThreadRealtimeReady(page);
}

test.describe("AI suggested replies", () => {
  test.beforeAll(async () => {
    await setWorkspaceAiEnabled(true);
  });

  test.afterAll(async () => {
    await setWorkspaceAiEnabled(true);
  });

  test("operator can suggest, accept, regenerate, and dismiss without auto-send", async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    const operatorPage = await operatorContext.newPage();

    const preview = `AI suggest ${Date.now()}`;
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, preview);
    await waitForWidgetRealtimeReady(visitorPage);

    await openSeededConversation(operatorPage, preview);

    const suggestButton = operatorPage.getByTestId("suggest-reply-button");
    await expect(suggestButton).toBeVisible();
    await suggestButton.click();

    const draft = operatorPage.getByTestId("suggested-reply-draft");
    await expect(draft).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await draft.inputValue()).trim().length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const firstSuggestion = (await draft.inputValue()).trim();
    const composer = operatorReplyComposer(operatorPage);
    await expect(composer).toHaveValue("");

    await operatorPage.getByTestId("suggested-reply-accept").click();
    await expect(composer).toHaveValue(firstSuggestion);

    // Accept must not auto-send.
    await expect(
      operatorPage.getByRole("article").filter({ hasText: firstSuggestion }),
    ).toHaveCount(0);

    await operatorPage.getByTestId("suggest-reply-button").click();
    await expect(draft).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await draft.inputValue()).trim().length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    const beforeRegen = (await draft.inputValue()).trim();
    await operatorPage.getByTestId("suggested-reply-regenerate").click();
    await expect
      .poll(async () => (await draft.inputValue()).trim(), { timeout: 30_000 })
      .not.toBe(beforeRegen);

    await operatorPage.getByTestId("suggested-reply-dismiss").click();
    await expect(operatorPage.getByTestId("suggested-reply-draft")).toHaveCount(0);
    await expect(operatorPage.getByTestId("suggest-reply-button")).toBeVisible();

    // Composer still holds previously accepted text; still not sent.
    await expect(composer).toHaveValue(firstSuggestion);
    await expect(
      operatorPage.getByRole("article").filter({ hasText: firstSuggestion }),
    ).toHaveCount(0);

    // Preserve existing realtime/message path: send a normal reply.
    const manualReply = `Manual reply ${Date.now()}`;
    await composer.fill(manualReply);
    await operatorPage.getByRole("button", { name: "Send reply" }).click();
    await expect(operatorPage.getByRole("article").filter({ hasText: manualReply })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      visitorPage
        .frameLocator('iframe[title="Site Chat"]')
        .getByRole("article")
        .getByText(manualReply),
    ).toBeVisible({ timeout: 30_000 });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("AI disabled hides suggest reply control", async ({ browser }) => {
    await setWorkspaceAiEnabled(false);

    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    const operatorPage = await operatorContext.newPage();

    const preview = `AI disabled ${Date.now()}`;
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, preview);

    await openSeededConversation(operatorPage, preview);

    await expect(operatorPage.getByTestId("suggest-reply-button")).toHaveCount(0);
    await expect(operatorPage.getByTestId("suggested-reply-panel")).toHaveCount(0);

    await setWorkspaceAiEnabled(true);
    await visitorContext.close();
    await operatorContext.close();
  });

  test("unauthorized callers cannot use suggested replies endpoint", async ({ request }) => {
    const response = await request.post(`${APP_URL}/api/v1/inbox/ai/suggested-replies`, {
      data: {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        conversationId: "22222222-2222-2222-2222-222222222222",
      },
    });

    expect([401, 403]).toContain(response.status());
  });

  test("authenticated member of another workspace is denied", async ({ browser }) => {
    const foreignWorkspaceId = await createForeignWorkspaceOwnedByAdmin();
    const acmeWorkspaceId = await getAcmeWorkspaceId();
    expect(foreignWorkspaceId).not.toEqual(acmeWorkspaceId);

    const context = await browser.newContext();
    const page = await context.newPage();
    // Authenticated owner of acme-support must not access admin's foreign workspace.
    await loginOperator(page);

    const response = await page.request.post(`${APP_URL}/api/v1/inbox/ai/suggested-replies`, {
      data: {
        workspaceId: foreignWorkspaceId,
        conversationId: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(response.status()).toBe(403);
    await context.close();
  });

  test("authenticated viewer without send_messages is denied", async ({ browser }) => {
    const setupContext = await browser.newContext();
    const setupPage = await setupContext.newPage();
    await loginAs(setupPage, VIEWER_EMAIL, OPERATOR_PASSWORD);
    const { workspaceId, conversationId } = await resolveSeededConversationId(setupPage);

    const response = await setupPage.request.post(`${APP_URL}/api/v1/inbox/ai/suggested-replies`, {
      data: {
        workspaceId,
        conversationId,
      },
    });

    expect(response.status()).toBe(403);
    await setupContext.close();
  });

  test("valid authenticated operator with permission can stream suggested replies", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginOperator(page);
    const { workspaceId, conversationId } = await resolveSeededConversationId(page);

    const response = await page.request.post(`${APP_URL}/api/v1/inbox/ai/suggested-replies`, {
      headers: {
        Accept: "text/event-stream",
      },
      data: {
        workspaceId,
        conversationId,
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toContain("text/event-stream");
    const body = await response.text();
    expect(body).toMatch(/data:/);
    expect(body).not.toMatch(/"type":"error"/);

    await context.close();
  });
});
