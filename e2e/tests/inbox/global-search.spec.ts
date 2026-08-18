import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

import {
  APP_URL,
  loginAs,
  loginOperator,
  openOperatorConversation,
  openWidget,
  sendWidgetMessage,
  VIEWER_EMAIL,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetComposer,
  widgetFrameLocator,
  WORKSPACE_SLUG,
} from "../../helpers";

const fixturesDir = path.join(process.cwd(), "e2e/fixtures");
const INBOX_URL = `${APP_URL}/app/${WORKSPACE_SLUG}/inbox`;
const CONTACTS_URL = `${APP_URL}/app/${WORKSPACE_SLUG}/contacts`;
const SEEDED_CONTACT_NAME = "Jane Cooper";
const SEEDED_CONTACT_EMAIL = "jane@example.com";

async function openInbox(page: Page) {
  await page.goto(INBOX_URL);
  await waitForOperatorInboxRealtimeReady(page);
}

async function openGlobalSearch(page: Page) {
  await page.getByTestId("global-search-trigger").click();
  await expect(page.getByTestId("global-search-dialog")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("global-search-input")).toBeFocused({
    timeout: 5_000,
  });
}

async function searchGlobal(page: Page, query: string) {
  const input = page.getByTestId("global-search-input");
  await input.fill(query);
  await expect(page.getByTestId("global-search-results")).toBeVisible({
    timeout: 15_000,
  });
}

async function waitForHit(page: Page, type: string, text: string) {
  const hit = page.getByTestId(`global-search-hit-${type}`).filter({ hasText: text });
  await expect(hit.first()).toBeVisible({ timeout: 45_000 });
  return hit.first();
}

test.describe("global search", () => {
  test("opens via trigger and Cmd/Ctrl+K", async ({ page }) => {
    await loginOperator(page);
    await openInbox(page);

    await openGlobalSearch(page);
    await page.getByTestId("global-search-close").click();
    await expect(page.getByTestId("global-search-dialog")).toHaveCount(0);

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+KeyK`);
    await expect(page.getByTestId("global-search-dialog")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("global-search-dialog")).toHaveCount(0);
  });

  test("searches seeded contact by name and email", async ({ page }) => {
    await loginOperator(page);
    await openInbox(page);
    await openGlobalSearch(page);

    await searchGlobal(page, SEEDED_CONTACT_NAME);
    await page.getByTestId("global-search-category-contacts").click();
    const byName = await waitForHit(page, "contact", SEEDED_CONTACT_NAME);
    await expect(byName).toContainText(SEEDED_CONTACT_EMAIL);

    await searchGlobal(page, SEEDED_CONTACT_EMAIL);
    await waitForHit(page, "contact", SEEDED_CONTACT_EMAIL);
  });

  test("searches message and opens conversation", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `gs-msg-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    await loginOperator(operator);
    await openInbox(operator);
    await openGlobalSearch(operator);
    await searchGlobal(operator, marker);
    await operator.getByTestId("global-search-category-messages").click();
    const hit = await waitForHit(operator, "message", marker);
    await hit.click();

    await expect(operator).toHaveURL(/\/inbox\/[0-9a-f-]+/, { timeout: 60_000 });
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByText(marker)).toBeVisible({ timeout: 30_000 });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("searches internal note with authorized role", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `gs-note-${Date.now()}`;
    const noteBody = `Internal note ${marker} for global search`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    await loginOperator(operator);
    await openInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    await operator.getByTestId("conversation-tab-notes").click();
    await expect(operator.getByTestId("internal-notes-panel")).toBeVisible({
      timeout: 30_000,
    });
    await operator.getByTestId("internal-note-composer").fill(noteBody);
    await operator.getByTestId("internal-note-send").click();
    await expect(
      operator.getByTestId("internal-note-item").filter({ hasText: marker }),
    ).toBeVisible({ timeout: 30_000 });

    // Leave the thread so the note deep-link navigates onto a fresh page load.
    await operator.goto(INBOX_URL);
    await waitForOperatorInboxRealtimeReady(operator);

    await openGlobalSearch(operator);
    await searchGlobal(operator, marker);
    await operator.getByTestId("global-search-category-notes").click();
    const hit = await waitForHit(operator, "note", marker);
    await Promise.all([operator.waitForURL(/tab=notes/, { timeout: 60_000 }), hit.click()]);
    await expect(operator).toHaveURL(/note=[0-9a-f-]{36}/i, {
      timeout: 15_000,
    });
    await expect(operator.getByTestId("internal-notes-panel")).toBeVisible({
      timeout: 30_000,
    });
    // Full navigation + SSR hydrate should show the note; allow catch-up.
    await expect(
      operator.getByTestId("internal-note-item").filter({ hasText: marker }),
    ).toBeVisible({ timeout: 45_000 });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("viewer cannot see notes category or note results", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `gs-viewer-note-${Date.now()}`;
    const noteBody = `Viewer hidden note ${marker}`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await loginOperator(owner);
    await openInbox(owner);
    await openOperatorConversation(owner, marker);
    await waitForOperatorThreadRealtimeReady(owner);
    await owner.getByTestId("conversation-tab-notes").click();
    await owner.getByTestId("internal-note-composer").fill(noteBody);
    await owner.getByTestId("internal-note-send").click();
    await expect(owner.getByTestId("internal-note-item").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await loginAs(viewer, VIEWER_EMAIL);
    await openInbox(viewer);
    await openGlobalSearch(viewer);

    await expect(viewer.getByTestId("global-search-category-notes")).toHaveCount(0);

    await searchGlobal(viewer, marker);
    await expect(viewer.getByTestId("global-search-hit-note")).toHaveCount(0);
    await expect(viewer.getByTestId("global-search-category-notes")).toHaveCount(0);

    await visitorContext.close();
    await ownerContext.close();
    await viewerContext.close();
  });

  test("searches attachment filename", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `gs-attach-${Date.now()}`;
    const uniqueName = `GsE2EInvoice-${Date.now()}.pdf`;
    const fixturePath = path.join(fixturesDir, "sample.pdf");

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, `${marker}-seed`);
    await waitForWidgetRealtimeReady(visitor);
    const frame = widgetFrameLocator(visitor);

    const bytes = await fs.readFile(fixturePath);
    await frame.getByTestId("widget-file-input").setInputFiles({
      name: uniqueName,
      mimeType: "application/pdf",
      buffer: bytes,
    });

    await expect(frame.getByTestId("pending-attachments")).toBeVisible({
      timeout: 15_000,
    });
    await widgetComposer(visitor).fill(marker);
    await frame.getByRole("button", { name: "Send" }).click();
    await expect(frame.getByTestId("attachment-document")).toBeVisible({
      timeout: 60_000,
    });

    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    await loginOperator(operator);
    await openInbox(operator);
    await openGlobalSearch(operator);
    await searchGlobal(operator, uniqueName.replace(/\.pdf$/, ""));
    await operator.getByTestId("global-search-category-attachments").click();
    await waitForHit(operator, "attachment", uniqueName);

    await visitorContext.close();
    await operatorContext.close();
  });

  test("keyboard navigation and no-result state", async ({ page }) => {
    await loginOperator(page);
    await openInbox(page);
    await openGlobalSearch(page);

    await searchGlobal(page, SEEDED_CONTACT_NAME);
    await page.getByTestId("global-search-category-contacts").click();
    await waitForHit(page, "contact", SEEDED_CONTACT_NAME);

    await page.keyboard.press("ArrowDown");
    await expect(
      page.locator('[data-testid="global-search-hit-contact"][aria-selected="true"]'),
    ).toBeVisible({ timeout: 10_000 });

    await searchGlobal(page, `no-such-hit-${Date.now()}-zzzz`);
    await expect(page.getByTestId("global-search-empty")).toBeVisible({
      timeout: 45_000,
    });
  });

  test("CRM contact name edit becomes searchable", async ({ page }) => {
    test.setTimeout(120_000);
    const renamed = `GS Search Name ${Date.now()}`;

    await loginOperator(page);
    await page.goto(`${CONTACTS_URL}?q=${encodeURIComponent(SEEDED_CONTACT_NAME)}`);
    await expect(page.getByTestId("contacts-page")).toBeVisible({
      timeout: 60_000,
    });
    const link = page.getByRole("link", { name: SEEDED_CONTACT_NAME }).first();
    await expect(link).toBeVisible({ timeout: 60_000 });
    await link.click();
    await expect(page.getByTestId("contact-profile-panel")).toBeVisible({
      timeout: 60_000,
    });

    const panel = page.getByTestId("contact-profile-panel");
    const form = panel.getByTestId("contact-identity-form");
    await panel.getByLabel("Name").fill(renamed);
    await expect(form).toHaveAttribute("data-pending", "false");
    await panel.getByTestId("contact-identity-save").click();
    await expect(form).toHaveAttribute("data-pending", "true", { timeout: 5_000 });
    await expect(form).toHaveAttribute("data-pending", "false", {
      timeout: 45_000,
    });
    await expect(panel.getByLabel("Name")).toHaveValue(renamed, {
      timeout: 30_000,
    });

    await openGlobalSearch(page);
    await searchGlobal(page, renamed);
    await page.getByTestId("global-search-category-contacts").click();
    await waitForHit(page, "contact", renamed);

    // Restore seeded name so later tests remain stable.
    await page.goto(`${CONTACTS_URL}?q=${encodeURIComponent(renamed)}`);
    await expect(page.getByRole("link", { name: renamed }).first()).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("link", { name: renamed }).first().click();
    await expect(page.getByTestId("contact-profile-panel")).toBeVisible({
      timeout: 60_000,
    });
    const restorePanel = page.getByTestId("contact-profile-panel");
    const restoreForm = restorePanel.getByTestId("contact-identity-form");
    await restorePanel.getByLabel("Name").fill(SEEDED_CONTACT_NAME);
    await expect(restoreForm).toHaveAttribute("data-pending", "false");
    await restorePanel.getByTestId("contact-identity-save").click();
    await expect(restoreForm).toHaveAttribute("data-pending", "false", {
      timeout: 45_000,
    });
  });

  test("closing palette does not apply stale search results", async ({ page }) => {
    await loginOperator(page);
    await openInbox(page);
    await openGlobalSearch(page);
    await searchGlobal(page, SEEDED_CONTACT_NAME);
    await waitForHit(page, "contact", SEEDED_CONTACT_NAME);

    await page.getByTestId("global-search-close").click();
    await expect(page.getByTestId("global-search-dialog")).toHaveCount(0);

    await openGlobalSearch(page);
    await expect(page.getByTestId("global-search-input")).toHaveValue("");
    await expect(page.getByTestId("global-search-hit-contact")).toHaveCount(0);
    await expect(page.getByText("Type to search this workspace")).toBeVisible();
  });

  test("deep-links message beyond the newest 50", async ({ browser }) => {
    test.setTimeout(300_000);
    const stamp = Date.now();
    const targetBody = `gs-deep-target-${stamp}`;
    const padPrefix = `gs-deep-pad-${stamp}`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, targetBody);
    await waitForWidgetRealtimeReady(visitor);

    // Pad beyond the newest-50 window via the widget (service_role cannot
    // INSERT into conversations/messages under RLS grants).
    const frame = widgetFrameLocator(visitor);
    const composer = widgetComposer(visitor);
    for (let i = 0; i < 51; i += 1) {
      await composer.fill(`${padPrefix}-${i}`);
      await frame.getByRole("button", { name: "Send" }).click();
    }
    await expect(frame.getByRole("article").getByText(`${padPrefix}-50`)).toBeVisible({
      timeout: 120_000,
    });

    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    await loginOperator(operator);
    await openInbox(operator);
    await openGlobalSearch(operator);
    await searchGlobal(operator, targetBody);
    await operator.getByTestId("global-search-category-messages").click();
    const hit = await waitForHit(operator, "message", targetBody);
    await hit.click();

    await expect(operator).toHaveURL(/message=[0-9a-f-]{36}/i, {
      timeout: 60_000,
    });
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByText(targetBody).first()).toBeVisible({
      timeout: 60_000,
    });
    const messageParam = new URL(operator.url()).searchParams.get("message");
    expect(messageParam).toBeTruthy();
    await expect(operator.locator(`[data-message-id="${messageParam}"]`)).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("viewer cannot find internal note body via message-like search", async ({ browser }) => {
    // Notes remain the primary private channel; this guards the palette UX path.
    test.setTimeout(180_000);
    const marker = `gs-viewer-priv-${Date.now()}`;
    const noteBody = `Private viewer deny ${marker}`;

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, `${marker}-seed`);
    await waitForWidgetRealtimeReady(visitor);

    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await loginOperator(owner);
    await openInbox(owner);
    await openOperatorConversation(owner, marker);
    await waitForOperatorThreadRealtimeReady(owner);
    await owner.getByTestId("conversation-tab-notes").click();
    await owner.getByTestId("internal-note-composer").fill(noteBody);
    await owner.getByTestId("internal-note-send").click();
    await expect(owner.getByTestId("internal-note-item").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await openGlobalSearch(owner);
    await searchGlobal(owner, marker);
    await owner.getByTestId("global-search-category-notes").click();
    await waitForHit(owner, "note", marker);

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await loginAs(viewer, VIEWER_EMAIL);
    await openInbox(viewer);
    await openGlobalSearch(viewer);
    await searchGlobal(viewer, marker);
    await expect(viewer.getByTestId("global-search-hit-note")).toHaveCount(0);
    await expect(viewer.getByTestId("global-search-category-notes")).toHaveCount(0);
    await expect(viewer.getByText(noteBody)).toHaveCount(0);

    await visitorContext.close();
    await ownerContext.close();
    await viewerContext.close();
  });
});
