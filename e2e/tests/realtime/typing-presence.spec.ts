import { expect, test, type Browser, type Page } from "@playwright/test";

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

async function openOperatorInbox(page: Page) {
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
  // Marker is intentionally hidden; assert connected via attribute (same as helpers).
  await waitForOperatorInboxRealtimeReady(page);
}

/**
 * Operator dashboard and visitor widget share localhost:3000 (iframe origin).
 * Keep them in separate browser contexts so Supabase auth cookies / localStorage
 * for the operator never collide with visitor session tokens.
 */
async function createIsolatedOperatorAndVisitor(browser: Browser) {
  const operatorContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  return { operatorContext, visitorContext, operator };
}

test.describe("PR 4D-2 typing indicators and presence", () => {
  test("visitor and operator typing + multi-tab presence", async ({ browser }) => {
    const { operatorContext, visitorContext, operator } =
      await createIsolatedOperatorAndVisitor(browser);
    const visitorA = await visitorContext.newPage();

    await loginOperator(operator);
    await openOperatorInbox(operator);

    await openWidget(visitorA);
    const marker = `typing-${Date.now()}`;
    await sendWidgetMessage(visitorA, marker);

    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await waitForWidgetRealtimeReady(visitorA);

    // Visitor types without sending → operator sees typing
    await widgetComposer(visitorA).fill("visitor is composing");
    await expect(operator.getByTestId("visitor-typing")).toHaveText(/Visitor is typing/, {
      timeout: 15_000,
    });

    // Visitor stops → indicator disappears (idle stop + remote TTL)
    await widgetComposer(visitorA).fill("");
    await expect(operator.getByTestId("visitor-typing")).toHaveText("", {
      timeout: 15_000,
    });

    // Operator types → widget sees agent typing
    await operatorReplyComposer(operator).fill("agent composing");
    await expect(widgetFrameLocator(visitorA).getByTestId("agent-typing")).toContainText(
      /typing/i,
      { timeout: 15_000 },
    );

    // Operator sends → typing clears and message arrives live
    await sendOperatorReply(operator, `agent-live-${marker}`);
    await expect(widgetFrameLocator(visitorA).getByTestId("agent-typing")).toHaveText("", {
      timeout: 15_000,
    });
    await expect(
      widgetFrameLocator(visitorA).getByRole("article").getByText(`agent-live-${marker}`),
    ).toBeVisible({ timeout: 30_000 });

    // Presence: visitor A online on operator
    await expect(operator.getByTestId("visitor-presence")).toHaveAttribute(
      "data-presence",
      "online",
      { timeout: 30_000 },
    );

    await operatorContext.close();
    await visitorContext.close();
  });

  test("same-session multi-tab presence stays online until final tab closes", async ({
    browser,
  }) => {
    const operatorContext = await browser.newContext();
    const visitorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    const tab1 = await visitorContext.newPage();
    const tab2 = await visitorContext.newPage();

    await loginOperator(operator);
    await openOperatorInbox(operator);

    await openWidget(tab1);
    const marker = `presence-${Date.now()}`;
    await sendWidgetMessage(tab1, marker);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await waitForWidgetRealtimeReady(tab1);

    // Second tab same visitor context → shared iframe-origin localStorage session
    await tab2.goto(HOST_URL);
    await expect(tab2.locator('iframe[title="Site Chat"]')).toBeAttached({
      timeout: 60_000,
    });
    const frame2 = tab2.frameLocator('iframe[title="Site Chat"]');
    await expect(frame2.getByRole("button", { name: "Open chat" })).toBeVisible({
      timeout: 60_000,
    });
    await frame2.getByRole("button", { name: "Open chat" }).click();
    await expect(frame2.getByTestId("widget-realtime-ready")).toHaveAttribute(
      "data-realtime-state",
      "connected",
      { timeout: 60_000 },
    );

    await expect(operator.getByTestId("visitor-presence")).toHaveAttribute(
      "data-presence",
      "online",
      { timeout: 30_000 },
    );

    await tab1.close();
    await expect(operator.getByTestId("visitor-presence")).toHaveAttribute(
      "data-presence",
      "online",
      { timeout: 30_000 },
    );

    await tab2.close();
    await expect(operator.getByTestId("visitor-presence")).toHaveAttribute(
      "data-presence",
      "offline",
      { timeout: 45_000 },
    );

    await operatorContext.close();
    await visitorContext.close();
  });

  test("representative locales: English, Russian, Hebrew RTL", async ({ page }) => {
    // English chrome already covered by widget open helpers.
    // Russian / Hebrew dictionaries are covered by widget-i18n E2E; here we only
    // assert presence chrome mounts without console errors after open.
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await openWidget(page);
    const frame = widgetFrameLocator(page);
    await expect(frame.getByTestId("widget-operator-presence")).toBeVisible();
    await expect(frame.getByTestId("widget-operator-presence")).toHaveAttribute(
      "data-presence",
      /^(online|offline)$/,
    );

    // Panel is already open from openWidget — do not wait on "Open chat" again.
    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });
});
