import { expect, test, type Page } from "@playwright/test";

import {
  AGENT_EMAIL,
  APP_URL,
  loginAs,
  loginOperator,
  openOperatorConversation,
  operatorReplyComposer,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
  VIEWER_EMAIL,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
} from "../../helpers";

const SETTINGS_URL = `${APP_URL}/app/acme-support/settings`;
const CANNED_URL = `${SETTINGS_URL}/canned-responses`;

/** Contact on the seeded open conversation — the source of `{{visitor.name}}`. */
const SEEDED_VISITOR_NAME = "Jane Cooper";
const WORKSPACE_NAME = "Acme Support";

async function openCannedSettings(page: Page) {
  await page.goto(CANNED_URL);
  await expect(page.getByTestId("canned-responses-page")).toBeVisible({
    timeout: 60_000,
  });
}

async function createSnippet(
  page: Page,
  input: {
    title: string;
    body: string;
    shortcut?: string;
    visibility?: "workspace" | "personal";
  },
) {
  await page.getByTestId("canned-create").click();
  await expect(page.getByTestId("canned-form")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("canned-form-title").fill(input.title);
  await page.getByTestId("canned-form-body").fill(input.body);
  if (input.shortcut) {
    await page.getByTestId("canned-form-shortcut").fill(input.shortcut);
  }
  if (input.visibility) {
    await page.getByTestId("canned-form-visibility").selectOption(input.visibility);
  }
  await page.getByTestId("canned-form-submit").click();
  await expect(page.getByTestId("canned-form")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("canned-item").filter({ hasText: input.title })).toBeVisible({
    timeout: 30_000,
  });
}

async function openSeededConversation(page: Page, email: string) {
  await loginAs(page, email);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
  await openOperatorConversation(page, SEEDED_OPEN_CONVERSATION_PREVIEW);
  await waitForOperatorThreadRealtimeReady(page);
}

test.describe("canned responses", () => {
  test("owner publishes a shared snippet, agent inserts it with variables, owner favorites then deletes it", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    // Shortcuts are unique per workspace among live rows, so a run-scoped suffix
    // keeps repeat runs against a non-reset database green.
    const suffix = String(Date.now());
    const shortcut = `refund-${suffix}`;
    const title = `Refund policy ${suffix}`;
    const body = `Hi {{visitor.name}}, your refund from {{workspace.name}} is on the way.`;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await loginOperator(ownerPage);

    // Settings hub links to the library.
    await ownerPage.goto(SETTINGS_URL);
    await ownerPage.getByTestId("settings-link-canned-responses").click();
    await expect(ownerPage.getByTestId("canned-responses-page")).toBeVisible({
      timeout: 60_000,
    });

    await createSnippet(ownerPage, { title, body, shortcut: `/${shortcut}` });
    const ownerItem = ownerPage.getByTestId("canned-item").filter({ hasText: title });
    await expect(ownerItem).toHaveAttribute("data-visibility", "workspace");

    // Agent inserts it from the composer via the slash menu.
    const agentContext = await browser.newContext();
    const agentPage = await agentContext.newPage();
    await openSeededConversation(agentPage, AGENT_EMAIL);

    const composer = operatorReplyComposer(agentPage);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.click();
    await composer.pressSequentially(`/refund-${suffix.slice(0, 6)}`, {
      delay: 20,
    });

    const menu = agentPage.getByTestId("canned-slash-menu");
    await expect(menu).toBeVisible({ timeout: 30_000 });
    const option = agentPage.getByTestId("canned-slash-option").filter({ hasText: title });
    await expect(option).toBeVisible({ timeout: 30_000 });
    await option.click();

    await expect(menu).toHaveCount(0, { timeout: 20_000 });
    await expect(composer).toHaveValue(
      new RegExp(`Hi ${SEEDED_VISITOR_NAME}, your refund from ${WORKSPACE_NAME}`),
      { timeout: 20_000 },
    );
    // The trigger is gone and no template syntax survived interpolation.
    await expect(composer).not.toHaveValue(/\{\{/);
    await expect(composer).not.toHaveValue(/\/refund-/);

    // Favorite: the snippet shows under the Favorites filter.
    await ownerItem.getByTestId("canned-favorite").click();
    await expect(ownerItem).toHaveAttribute("data-favorited", "true", {
      timeout: 30_000,
    });
    await ownerPage.getByTestId("canned-tab-favorites").click();
    await expect(ownerPage.getByTestId("canned-item").filter({ hasText: title })).toBeVisible({
      timeout: 30_000,
    });

    // Soft delete: two-step confirm, then the row leaves every filter.
    await ownerPage.getByTestId("canned-tab-all").click();
    const deletable = ownerPage.getByTestId("canned-item").filter({ hasText: title });
    await deletable.getByTestId("canned-delete").click();
    await deletable.getByTestId("canned-delete-confirm").click();
    await expect(ownerPage.getByTestId("canned-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 30_000,
    });

    await ownerPage.reload();
    await expect(ownerPage.getByTestId("canned-responses-page")).toBeVisible({
      timeout: 60_000,
    });
    await expect(ownerPage.getByTestId("canned-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 30_000,
    });

    await agentContext.close();
    await ownerContext.close();
  });

  test("personal snippets stay private to their owner", async ({ browser }) => {
    test.setTimeout(120_000);
    const title = `Agent personal ${Date.now()}`;

    const agentContext = await browser.newContext();
    const agentPage = await agentContext.newPage();
    await loginAs(agentPage, AGENT_EMAIL);
    await openCannedSettings(agentPage);

    // Agents may not publish shared snippets, so the form is personal-only.
    await expect(agentPage.getByTestId("canned-agent-notice")).toBeVisible();
    await createSnippet(agentPage, {
      title,
      body: "Personal reminder for my own replies.",
    });
    const agentItem = agentPage.getByTestId("canned-item").filter({ hasText: title });
    await expect(agentItem).toHaveAttribute("data-visibility", "personal");
    await agentPage.getByTestId("canned-tab-personal").click();
    await expect(agentItem).toBeVisible();

    // The owner administers the workspace but never sees another member's
    // personal library.
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await loginOperator(ownerPage);
    await openCannedSettings(ownerPage);
    await expect(ownerPage.getByTestId("canned-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 30_000,
    });
    await ownerPage.getByTestId("canned-search").fill(title);
    await expect(ownerPage.getByTestId("canned-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 30_000,
    });

    // Clean up so repeat runs start from the same library.
    await agentPage.getByTestId("canned-tab-all").click();
    const deletable = agentPage.getByTestId("canned-item").filter({ hasText: title });
    await deletable.getByTestId("canned-delete").click();
    await deletable.getByTestId("canned-delete-confirm").click();
    await expect(agentPage.getByTestId("canned-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 30_000,
    });

    await ownerContext.close();
    await agentContext.close();
  });

  test("viewer reads the library but cannot create, favorite or insert", async ({ browser }) => {
    test.setTimeout(120_000);
    const title = `Viewer visible ${Date.now()}`;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await loginOperator(ownerPage);
    await openCannedSettings(ownerPage);
    await createSnippet(ownerPage, {
      title,
      body: "Shared snippet a viewer may read.",
    });

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await loginAs(viewerPage, VIEWER_EMAIL);
    await openCannedSettings(viewerPage);

    await expect(viewerPage.getByTestId("canned-viewer-notice")).toBeVisible();
    const viewerItem = viewerPage.getByTestId("canned-item").filter({ hasText: title });
    await expect(viewerItem).toBeVisible({ timeout: 30_000 });
    await expect(viewerPage.getByTestId("canned-create")).toHaveCount(0);
    await expect(viewerPage.getByTestId("canned-folder-create")).toHaveCount(0);
    await expect(viewerItem.getByTestId("canned-favorite")).toHaveCount(0);
    await expect(viewerItem.getByTestId("canned-edit")).toHaveCount(0);
    await expect(viewerItem.getByTestId("canned-delete")).toHaveCount(0);

    // Viewers cannot reply at all, so the composer (and its slash menu) is absent.
    await viewerPage.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(viewerPage);
    await openOperatorConversation(viewerPage, SEEDED_OPEN_CONVERSATION_PREVIEW);
    await waitForOperatorThreadRealtimeReady(viewerPage);
    await expect(operatorReplyComposer(viewerPage)).toHaveCount(0);
    await expect(viewerPage.getByTestId("canned-slash-hint")).toHaveCount(0);

    const deletable = ownerPage.getByTestId("canned-item").filter({ hasText: title });
    await deletable.getByTestId("canned-delete").click();
    await deletable.getByTestId("canned-delete-confirm").click();
    await expect(ownerPage.getByTestId("canned-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 30_000,
    });

    await viewerContext.close();
    await ownerContext.close();
  });
});
