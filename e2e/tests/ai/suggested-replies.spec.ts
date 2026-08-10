import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import {
  APP_URL,
  HOST_URL,
  WORKSPACE_SLUG,
  loginOperator,
  openOperatorConversation,
  openWidget,
  operatorReplyComposer,
  sendWidgetMessage,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
} from "../../helpers";

const PREVIEW = `AI suggest ${Date.now()}`;

async function setWorkspaceAiEnabled(enabled: boolean) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env for AI E2E helper");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

    await openWidget(visitorPage);
    await waitForWidgetRealtimeReady(visitorPage);
    await sendWidgetMessage(visitorPage, PREVIEW);

    await openSeededConversation(operatorPage, PREVIEW);

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

  test("non-member cannot call suggested replies for a workspace", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(HOST_URL);

    const response = await page.request.post(`${APP_URL}/api/v1/inbox/ai/suggested-replies`, {
      data: {
        workspaceId: "11111111-1111-1111-1111-111111111111",
        conversationId: "22222222-2222-2222-2222-222222222222",
      },
    });

    expect([401, 403]).toContain(response.status());
    await context.close();
  });
});
