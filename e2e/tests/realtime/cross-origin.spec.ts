import { expect, test } from "@playwright/test";

import {
  APP_URL,
  HOST_URL,
  WORKSPACE_SLUG,
  loginOperator,
  openOperatorConversation,
  openWidget,
  operatorReplyComposer,
  sendOperatorReply,
  sendWidgetMessage,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetComposer,
  widgetFrameLocator,
} from "../../helpers";

test.describe("PR 4C realtime cross-origin", () => {
  test("visitor message appears in operator inbox live", async ({ browser }) => {
    const operatorContext = await browser.newContext();
    const widgetContext = await browser.newContext();

    const operatorPage = await operatorContext.newPage();
    const widgetPage = await widgetContext.newPage();

    await loginOperator(operatorPage);
    await operatorPage.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await waitForOperatorInboxRealtimeReady(operatorPage);

    await openWidget(widgetPage);
    await sendWidgetMessage(widgetPage, "Hello from visitor e2e");

    await expect(operatorPage.getByText("Hello from visitor e2e")).toBeVisible({
      timeout: 20_000,
    });

    await operatorContext.close();
    await widgetContext.close();
  });

  test("operator reply appears in widget live", async ({ browser }) => {
    const operatorContext = await browser.newContext();
    const widgetContext = await browser.newContext();

    const operatorPage = await operatorContext.newPage();
    const widgetPage = await widgetContext.newPage();
    const visitorMessage = `Need help please ${Date.now()}`;

    await openWidget(widgetPage);
    await sendWidgetMessage(widgetPage, visitorMessage);
    await waitForWidgetRealtimeReady(widgetPage);

    await loginOperator(operatorPage);
    await operatorPage.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await waitForOperatorInboxRealtimeReady(operatorPage);
    await openOperatorConversation(operatorPage, visitorMessage);
    await waitForOperatorThreadRealtimeReady(operatorPage);
    await sendOperatorReply(operatorPage, "Operator live reply");

    await expect(widgetFrameLocator(widgetPage).getByText("Operator live reply")).toBeVisible({
      timeout: 30_000,
    });

    await operatorContext.close();
    await widgetContext.close();
  });

  test("open thread live append while operator is viewing conversation", async ({ browser }) => {
    const operatorContext = await browser.newContext();
    const widgetContext = await browser.newContext();

    const operatorPage = await operatorContext.newPage();
    const widgetPage = await widgetContext.newPage();
    const seedMessage = `Seed for open thread test ${Date.now()}`;

    await openWidget(widgetPage);
    await sendWidgetMessage(widgetPage, seedMessage);

    await loginOperator(operatorPage);
    await operatorPage.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await waitForOperatorInboxRealtimeReady(operatorPage);
    await openOperatorConversation(operatorPage, seedMessage);
    await expect(operatorReplyComposer(operatorPage)).toBeVisible();
    await waitForOperatorThreadRealtimeReady(operatorPage);

    await sendWidgetMessage(widgetPage, "Append while thread open");

    await expect(
      operatorPage.getByRole("article").getByText("Append while thread open"),
    ).toBeVisible({
      timeout: 20_000,
    });

    await operatorContext.close();
    await widgetContext.close();
  });

  test("reconnect catch-up does not duplicate messages", async ({ browser }) => {
    const widgetContext = await browser.newContext();
    const widgetPage = await widgetContext.newPage();

    await openWidget(widgetPage);
    await widgetPage.context().setOffline(true);
    await sendWidgetMessage(widgetPage, "Offline message");
    await widgetPage.context().setOffline(false);

    await expect(
      widgetFrameLocator(widgetPage).getByRole("article").getByText("Offline message"),
    ).toHaveCount(1, {
      timeout: 60_000,
    });

    await widgetContext.close();
  });

  test("filtered inbox updates when visitor sends a new message", async ({ browser }) => {
    const operatorContext = await browser.newContext();
    const widgetContext = await browser.newContext();

    const operatorPage = await operatorContext.newPage();
    const widgetPage = await widgetContext.newPage();

    await loginOperator(operatorPage);
    await operatorPage.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox?status=open`);
    await waitForOperatorInboxRealtimeReady(operatorPage);

    await openWidget(widgetPage);
    const uniquePreview = `Filtered inbox ${Date.now()}`;
    await sendWidgetMessage(widgetPage, uniquePreview);

    await expect(operatorPage.getByText(uniquePreview)).toBeVisible({
      timeout: 20_000,
    });

    await operatorContext.close();
    await widgetContext.close();
  });

  test("operator optimistic pending resolves to confirmed message", async ({ browser }) => {
    const operatorContext = await browser.newContext();
    const widgetContext = await browser.newContext();

    const operatorPage = await operatorContext.newPage();
    const widgetPage = await widgetContext.newPage();
    const triggerMessage = `Trigger operator optimistic send ${Date.now()}`;

    await openWidget(widgetPage);
    await sendWidgetMessage(widgetPage, triggerMessage);

    await loginOperator(operatorPage);
    await operatorPage.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await waitForOperatorInboxRealtimeReady(operatorPage);
    await openOperatorConversation(operatorPage, triggerMessage);
    await waitForOperatorThreadRealtimeReady(operatorPage);

    const reply = "Optimistic operator confirmation";
    await operatorReplyComposer(operatorPage).fill(reply);
    await operatorPage.getByRole("button", { name: "Send reply" }).click();

    await expect(operatorPage.getByRole("article").getByText("Sending...")).toBeVisible({
      timeout: 5_000,
    });
    await expect(operatorPage.getByRole("article").getByText(reply)).toBeVisible({
      timeout: 20_000,
    });
    await expect(operatorPage.getByRole("article").getByText("Sending...")).toHaveCount(0);

    await operatorContext.close();
    await widgetContext.close();
  });

  test("widget failed send retries with the same clientMessageId", async ({ browser }) => {
    const widgetContext = await browser.newContext();
    const widgetPage = await widgetContext.newPage();

    let sendAttempts = 0;
    await widgetPage.route("**/api/v1/widget/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      sendAttempts += 1;
      if (sendAttempts === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await openWidget(widgetPage);
    const body = "Retry with same clientMessageId";
    const frame = widgetFrameLocator(widgetPage);
    await widgetComposer(widgetPage).fill(body);
    await frame.getByRole("button", { name: "Send" }).click();

    await expect(frame.getByRole("button", { name: "Retry" })).toBeVisible({
      timeout: 30_000,
    });
    await frame.getByRole("button", { name: "Retry" }).click();
    await frame.getByRole("button", { name: "Send" }).click();

    await expect(frame.getByRole("article").getByText(body)).toHaveCount(1, {
      timeout: 30_000,
    });
    expect(sendAttempts).toBeGreaterThanOrEqual(2);

    await widgetContext.close();
  });

  test("connection banner reflects offline and recovery states", async ({ browser }) => {
    const widgetContext = await browser.newContext();
    const widgetPage = await widgetContext.newPage();

    await openWidget(widgetPage);
    // Establish a conversation so Realtime can reach a connected state after recovery.
    await sendWidgetMessage(widgetPage, `offline-banner-seed-${Date.now()}`);
    await waitForWidgetRealtimeReady(widgetPage);

    const frame = widgetFrameLocator(widgetPage);
    const connectionBanner = frame.getByTestId("widget-connection-status");

    await widgetPage.context().setOffline(true);

    await expect(connectionBanner).toBeVisible({ timeout: 30_000 });
    await expect(connectionBanner).toHaveAttribute(
      "data-connection-state",
      /^(disconnected|reconnecting|failed)$/,
    );
    await expect(frame.getByRole("status")).toHaveAttribute(
      "data-testid",
      "widget-connection-status",
    );

    await widgetPage.context().setOffline(false);

    await expect(connectionBanner).toHaveCount(0, { timeout: 60_000 });
    await expect(frame.getByTestId("widget-realtime-ready")).toHaveAttribute(
      "data-realtime-state",
      "connected",
      { timeout: 60_000 },
    );

    await sendWidgetMessage(widgetPage, "Recovered after offline");

    await widgetContext.close();
  });

  test("URLs never include session or signing secrets", async ({ browser }) => {
    const widgetContext = await browser.newContext();
    const widgetPage = await widgetContext.newPage();

    await openWidget(widgetPage);
    expect(widgetPage.url()).not.toMatch(/session|token|secret|Bearer/i);

    await widgetContext.close();
  });
});
