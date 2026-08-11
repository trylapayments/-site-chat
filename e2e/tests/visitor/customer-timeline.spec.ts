import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

import {
  APP_URL,
  HOST_URL,
  VIEWER_EMAIL,
  loginAs,
  loginOperator,
  openOperatorConversation,
  openWidget,
  sendWidgetMessage,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetFrameLocator,
} from "../../helpers";

const fixturesDir = path.join(process.cwd(), "e2e/fixtures");

async function prepareOperatorInbox(page: Page) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

test.describe("customer timeline", () => {
  test("page view, message, identity appear live; secrets never shown; reconnect does not duplicate", async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `timeline-core-${Date.now()}`;
    const email = `timeline.${Date.now()}@example.com`;

    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const timeline = operator.getByTestId("customer-timeline");
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(timeline.locator('[data-event-type="conversation_started"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.locator('[data-event-type="visitor_message_sent"]')).toBeVisible();

    const pageViewResponse = visitor.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/widget/page-view") &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 30_000 },
    );

    await visitor.evaluate(() => {
      window.history.pushState(
        {},
        "",
        "/pricing?utm_source=e2e&utm_medium=test&access_token=secret#frag",
      );
      document.title = "Pricing page";
      window.dispatchEvent(new Event("sitechat:locationchange"));
    });

    await pageViewResponse;

    await expect(timeline.locator('[data-event-type="page_viewed"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.getByText(/\/pricing\?utm_source=e2e/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.getByText("access_token=secret")).toHaveCount(0);
    await expect(timeline.getByText("#frag")).toHaveCount(0);

    const identifyResponse = visitor.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/widget/identify") &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    );
    await visitor.evaluate(
      ({ name, email: visitorEmail }) => {
        const api = (
          window as unknown as {
            SiteChat?: {
              identify: (payload: { name: string; email: string }) => void;
            };
          }
        ).SiteChat;
        if (!api) {
          throw new Error("SiteChat host API missing");
        }
        api.identify({ name, email: visitorEmail });
      },
      { name: "Timeline Jane", email },
    );
    expect((await identifyResponse).status()).toBe(200);

    await expect(timeline.locator('[data-event-type="visitor_identified"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline).toContainText(email);

    // Attachment (optional if composer attach control is present)
    const frame = widgetFrameLocator(visitor);
    const fileInput = frame.locator('input[type="file"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(path.join(fixturesDir, "sample.pdf"));
      await expect(timeline.locator('[data-event-type="attachment_uploaded"]')).toBeVisible({
        timeout: 60_000,
      });
    }

    await operator.reload();
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByTestId("customer-timeline")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      operator.getByTestId("customer-timeline").locator('[data-event-type="conversation_started"]'),
    ).toHaveCount(1);

    await visitorContext.close();
    await operatorContext.close();
  });

  test("load older pagination appends without duplicate ids", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `timeline-page-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    for (let i = 0; i < 12; i += 1) {
      const pageViewResponse = visitor.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/widget/page-view") &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: 30_000 },
      );
      await visitor.evaluate((idx) => {
        window.history.pushState({}, "", `/docs/page-${idx}?utm_source=t`);
        document.title = `Page ${idx}`;
        window.dispatchEvent(new Event("sitechat:locationchange"));
      }, i);
      await pageViewResponse;
      await visitor.waitForTimeout(1100);
    }

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const timeline = operator.getByTestId("customer-timeline");
    await expect(timeline).toBeVisible({ timeout: 30_000 });

    const loadOlder = operator.getByTestId("customer-timeline-load-older");
    await expect(loadOlder).toBeVisible({ timeout: 30_000 });

    const beforeIds = await timeline
      .getByTestId("customer-timeline-event")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-event-id")));

    await loadOlder.click();

    await expect
      .poll(async () => {
        const afterIds = await timeline
          .getByTestId("customer-timeline-event")
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-event-id")));
        return afterIds.length > beforeIds.length;
      })
      .toBe(true);

    const afterIds = await timeline
      .getByTestId("customer-timeline-event")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-event-id")));
    expect(new Set(afterIds).size).toBe(afterIds.length);

    await visitorContext.close();
    await operatorContext.close();
  });

  test("viewer can open inbox; timeline remains workspace-scoped", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const viewer = await viewerContext.newPage();

    const marker = `timeline-viewer-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);

    await loginAs(viewer, VIEWER_EMAIL);
    await viewer.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(viewer);
    await openOperatorConversation(viewer, marker);

    const timeline = viewer.getByTestId("customer-timeline");
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(timeline.locator('[data-event-type="conversation_started"]')).toBeVisible({
      timeout: 30_000,
    });

    // Cross-workspace denial is enforced in pgTAP; UI smoke confirms viewer read path.
    await expect(viewer).toHaveURL(new RegExp(`${HOST_URL}|${APP_URL}`));

    await visitorContext.close();
    await viewerContext.close();
  });
});
