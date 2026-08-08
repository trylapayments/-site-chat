import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  APP_URL,
  HOST_URL,
  WORKSPACE_SLUG,
  loginOperator,
  openOperatorConversation,
  openWidget,
  sendOperatorReply,
  sendWidgetMessage,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetFrameLocator,
} from "../../helpers";

async function openOperatorInbox(page: Page) {
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

async function createIsolatedOperatorAndVisitor(browser: Browser) {
  const operatorContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  return { operatorContext, visitorContext, operator };
}

test.describe("PR 4D-3 read receipts and unread counters", () => {
  test("visitor→operator delivered, open→seen, unread badge, reorder", async ({ browser }) => {
    const { operatorContext, visitorContext, operator } =
      await createIsolatedOperatorAndVisitor(browser);
    const visitor = await visitorContext.newPage();

    await loginOperator(operator);
    await openOperatorInbox(operator);

    await openWidget(visitor);
    const marker = `receipts-${Date.now()}`;
    await sendWidgetMessage(visitor, marker);

    // Unread badge appears and conversation is near top
    const unreadBadge = operator.getByTestId("conversation-unread-badge").first();
    await expect(unreadBadge).toBeVisible({ timeout: 30_000 });
    await expect(operator.getByTestId("inbox-unread-total")).toBeVisible({
      timeout: 30_000,
    });

    const firstPreview = operator.getByRole("row").nth(1);
    await expect(firstPreview).toContainText(marker, { timeout: 30_000 });

    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await waitForWidgetRealtimeReady(visitor);

    // Operator reply → visitor should show delivered (and later seen when viewing)
    const reply = `agent-receipt-${marker}`;
    await sendOperatorReply(operator, reply);

    const widgetFrame = widgetFrameLocator(visitor);
    await expect(widgetFrame.getByRole("article").getByText(reply)).toBeVisible({
      timeout: 30_000,
    });

    // Visitor's own prior message should become delivered/seen after operator open
    await expect(widgetFrame.getByTestId("message-receipt").first()).toHaveAttribute(
      /data-receipt/,
      /delivered|seen/,
      { timeout: 30_000 },
    );

    // Operator agent messages show visitor receipt ticks once visitor delivers
    await expect(operator.getByTestId("message-receipt").first()).toHaveAttribute(
      "data-receipt",
      /delivered|seen/,
      { timeout: 30_000 },
    );

    // Marking conversation read clears unread on reopen of inbox
    await openOperatorInbox(operator);
    await expect(
      operator
        .getByRole("row")
        .filter({ hasText: marker })
        .getByTestId("conversation-unread-badge"),
    ).toHaveCount(0, { timeout: 30_000 });

    await operatorContext.close();
    await visitorContext.close();
  });

  test("visitor open marks agent messages seen; multi-tab read sync", async ({ browser }) => {
    const operatorContext = await browser.newContext();
    const visitorContext = await browser.newContext();
    const operatorA = await operatorContext.newPage();
    const operatorB = await operatorContext.newPage();
    const visitor = await visitorContext.newPage();

    await loginOperator(operatorA);
    await openOperatorInbox(operatorA);
    await operatorB.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await waitForOperatorInboxRealtimeReady(operatorB);

    await openWidget(visitor);
    const marker = `multitab-read-${Date.now()}`;
    await sendWidgetMessage(visitor, marker);

    await expect(
      operatorA
        .getByRole("row")
        .filter({ hasText: marker })
        .getByTestId("conversation-unread-badge"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      operatorB
        .getByRole("row")
        .filter({ hasText: marker })
        .getByTestId("conversation-unread-badge"),
    ).toBeVisible({ timeout: 30_000 });

    await openOperatorConversation(operatorA, marker);
    await waitForOperatorThreadRealtimeReady(operatorA);

    // Tab B inbox should clear unread via member-read CDC (no duplicate UX)
    await expect(
      operatorB
        .getByRole("row")
        .filter({ hasText: marker })
        .getByTestId("conversation-unread-badge"),
    ).toHaveCount(0, { timeout: 45_000 });

    const reply = `seen-by-visitor-${marker}`;
    await sendOperatorReply(operatorA, reply);

    const frame = widgetFrameLocator(visitor);
    await expect(frame.getByRole("article").getByText(reply)).toBeVisible({
      timeout: 30_000,
    });

    // Panel open + visible → visitor marks read → operator sees Seen
    await expect(operatorA.getByTestId("message-receipt").last()).toHaveAttribute(
      "data-receipt",
      "seen",
      { timeout: 45_000 },
    );

    await operatorContext.close();
    await visitorContext.close();
  });

  test("reconnect and offline recovery preserve receipt catch-up", async ({ browser }) => {
    const { operatorContext, visitorContext, operator } =
      await createIsolatedOperatorAndVisitor(browser);
    const visitor = await visitorContext.newPage();

    await loginOperator(operator);
    await openOperatorInbox(operator);
    await openWidget(visitor);

    const marker = `offline-receipt-${Date.now()}`;
    await sendWidgetMessage(visitor, marker);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await waitForWidgetRealtimeReady(visitor);

    await visitor.context().setOffline(true);
    const reply = `offline-reply-${marker}`;
    await sendOperatorReply(operator, reply);

    await visitor.context().setOffline(false);
    await visitor.goto(HOST_URL);
    await openWidget(visitor);
    await waitForWidgetRealtimeReady(visitor);

    const frame = widgetFrameLocator(visitor);
    await expect(frame.getByRole("article").getByText(reply)).toBeVisible({
      timeout: 60_000,
    });

    // After catch-up + visible panel, operator should eventually see delivered/seen
    await expect(operator.getByTestId("message-receipt").last()).toHaveAttribute(
      "data-receipt",
      /delivered|seen/,
      { timeout: 60_000 },
    );

    await operatorContext.close();
    await visitorContext.close();
  });
});
