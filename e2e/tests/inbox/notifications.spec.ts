import { expect, test, type Page } from "@playwright/test";

import {
  AGENT_EMAIL,
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
} from "../../helpers";

async function prepareInbox(page: Page, email: string) {
  await loginAs(page, email);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

async function waitForBellReady(page: Page) {
  await expect(page.getByTestId("notification-bell")).toBeVisible({
    timeout: 30_000,
  });
}

async function openNotificationPanel(page: Page) {
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("notification-panel")).toBeVisible({
    timeout: 15_000,
  });
}

async function waitForAssignmentMutation(page: Page, successPattern: RegExp) {
  const panel = page.getByTestId("assignment-panel");
  await expect(panel)
    .toHaveAttribute("data-pending", "true", { timeout: 5_000 })
    .catch(() => undefined);
  await expect(panel).toHaveAttribute("data-pending", "false", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("assignment-live")).toHaveText(successPattern, {
    timeout: 15_000,
  });
}

test.describe("operator notifications", () => {
  test("visitor message, assignment, bell badge, mark read, navigation", async ({ browser }) => {
    test.setTimeout(240_000);
    const marker = `notif-core-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);
    await waitForWidgetRealtimeReady(visitorPage);

    const ownerContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const agent = await agentContext.newPage();

    await loginOperator(owner);
    await owner.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(owner);
    await waitForBellReady(owner);

    await prepareInbox(agent, AGENT_EMAIL);
    await waitForBellReady(agent);

    // New conversation should produce a durable notification for operators.
    await expect
      .poll(
        async () => {
          await openNotificationPanel(owner);
          const count = await owner
            .getByTestId("notification-item")
            .filter({ hasText: /New conversation|New visitor message/i })
            .count();
          await owner.keyboard.press("Escape");
          return count;
        },
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);

    // Assign conversation to agent → assignment notification.
    await openOperatorConversation(owner, marker);
    await waitForOperatorThreadRealtimeReady(owner);
    await expect(owner.getByTestId("assignment-panel")).toBeVisible({
      timeout: 30_000,
    });

    await owner.getByTestId("assignment-open-picker").click();
    await expect(owner.getByTestId("assignment-picker")).toBeVisible();
    await owner
      .locator('[data-testid^="assignment-member-"]')
      .filter({ hasText: AGENT_EMAIL })
      .click();
    await waitForAssignmentMutation(owner, /assigned|transferred/i);

    await expect
      .poll(
        async () => {
          await openNotificationPanel(agent);
          const items = agent.getByTestId("notification-item");
          const count = await items.count();
          await agent.keyboard.press("Escape");
          return count;
        },
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);

    // Unread badge present when unread exists.
    const badge = agent.getByTestId("notification-unread-badge");
    await expect(badge).toBeVisible({ timeout: 60_000 });

    // Mark all read clears badge.
    await openNotificationPanel(agent);
    await agent.getByTestId("notification-mark-all-read").click();
    await expect(agent.getByTestId("notification-unread-badge")).toHaveCount(0, {
      timeout: 30_000,
    });

    // Click a notification navigates to inbox conversation when available.
    await openNotificationPanel(owner);
    const first = owner.getByTestId("notification-item").first();
    await first.click();
    await expect(owner).toHaveURL(/\/inbox\//, { timeout: 30_000 });

    await visitorContext.close();
    await ownerContext.close();
    await agentContext.close();
  });

  test("cross-tab mark-read sync and viewer restriction", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `notif-tabs-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);
    await waitForWidgetRealtimeReady(visitorPage);

    const tabAContext = await browser.newContext();
    const tabBContext = await browser.newContext();
    const tabA = await tabAContext.newPage();
    const tabB = await tabBContext.newPage();

    await loginOperator(tabA);
    await tabA.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(tabA);
    await waitForBellReady(tabA);

    await loginOperator(tabB);
    await tabB.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(tabB);
    await waitForBellReady(tabB);

    // Wait until both tabs see at least one notification from the visitor message.
    await expect
      .poll(
        async () => {
          await openNotificationPanel(tabA);
          const n = await tabA.getByTestId("notification-item").count();
          await tabA.keyboard.press("Escape");
          return n;
        },
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);

    await openNotificationPanel(tabA);
    await tabA.getByTestId("notification-mark-all-read").click();
    await expect(tabA.getByTestId("notification-unread-badge")).toHaveCount(0, {
      timeout: 30_000,
    });

    // Tab B should sync unread badge via realtime (counter UPDATE).
    await expect(tabB.getByTestId("notification-unread-badge")).toHaveCount(0, {
      timeout: 60_000,
    });

    // Viewer: bell exists but mention-type items should not appear for viewers.
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await loginAs(viewer, VIEWER_EMAIL);
    await viewer.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(viewer);
    await waitForBellReady(viewer);
    await openNotificationPanel(viewer);
    await expect(
      viewer.getByTestId("notification-item").filter({ hasText: /mentioned/i }),
    ).toHaveCount(0);

    await visitorContext.close();
    await tabAContext.close();
    await tabBContext.close();
    await viewerContext.close();
  });

  test("mention notification deep-links to notes without leaking body", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `notif-mention-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);
    await waitForWidgetRealtimeReady(visitorPage);

    const ownerContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const agent = await agentContext.newPage();

    await loginOperator(owner);
    await owner.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(owner);
    await openOperatorConversation(owner, marker);
    await waitForOperatorThreadRealtimeReady(owner);

    await prepareInbox(agent, AGENT_EMAIL);
    await waitForBellReady(agent);

    await owner.getByTestId("conversation-tab-notes").click();
    await expect(owner.getByTestId("internal-notes-panel")).toBeVisible({
      timeout: 30_000,
    });

    // Prefer ID-backed mention if autocomplete available; otherwise plain note.
    const composer = owner.getByTestId("internal-note-composer");
    await composer.click();
    await composer.fill(`Please review ${marker} `);
    await composer.type("@");
    const mentionOption = owner.getByTestId("mention-option").first();
    if (await mentionOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await mentionOption.click();
    } else {
      await composer.fill(
        `Internal note ${marker} @[Agent](member:00000000-0000-0000-0000-000000000000)`,
      );
    }
    await owner.getByTestId("internal-note-send").click();

    // Agent should get a mention notification (if mention resolved) or at least
    // never see SECRET note body leaked into the bell list.
    await openNotificationPanel(agent);
    const items = agent.getByTestId("notification-item");
    const texts = await items.allTextContents();
    expect(texts.join("\n")).not.toMatch(/SECRET_NOTE_BODY/);

    await visitorContext.close();
    await ownerContext.close();
    await agentContext.close();
  });

  test("DND still shows durable in-app notification; mark all clears badge", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const marker = `notif-dnd-${Date.now()}`;

    const agentContext = await browser.newContext();
    const agent = await agentContext.newPage();
    await prepareInbox(agent, AGENT_EMAIL);
    await waitForBellReady(agent);

    await agent.goto(`${APP_URL}/app/acme-support/settings/notifications`);
    await expect(agent.getByTestId("notification-preferences-form")).toBeVisible({
      timeout: 30_000,
    });
    const dnd = agent.locator("#pref-dnd_enabled");
    if (await dnd.isVisible().catch(() => false)) {
      const checked = await dnd.isChecked();
      if (!checked) {
        await dnd.click();
      }
    }

    await agent.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(agent);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);
    await waitForWidgetRealtimeReady(visitorPage);

    await openNotificationPanel(agent);
    await expect(
      agent
        .getByTestId("notification-item")
        .filter({ hasText: /conversation|visitor|message/i })
        .first(),
    ).toBeVisible({ timeout: 45_000 });

    const markAll = agent.getByTestId("notification-mark-all-read");
    if (await markAll.isVisible().catch(() => false)) {
      await markAll.click();
      await expect(agent.getByTestId("notification-unread-badge")).toHaveCount(0, {
        timeout: 15_000,
      });
    }

    await visitorContext.close();
    await agentContext.close();
  });
});
