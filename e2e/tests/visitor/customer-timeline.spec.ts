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
  widgetComposer,
  widgetFrameLocator,
} from "../../helpers";

const fixturesDir = path.join(process.cwd(), "e2e/fixtures");

/** Enough unique page views so conversation + message + pages exceed the default page size (20). */
const PAGINATION_PAGE_VIEW_COUNT = 28;
/** Missed events while offline must exceed one catch-up page. */
const RECONNECT_MISSED_PAGE_VIEWS = 25;

async function prepareOperatorInbox(page: Page) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

async function recordUniquePageView(visitor: Page, pathSuffix: string) {
  const pageViewResponse = visitor.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/widget/page-view") &&
      response.request().method() === "POST" &&
      response.status() === 200,
    { timeout: 30_000 },
  );
  await visitor.evaluate((suffix) => {
    window.history.pushState({}, "", `/docs/${suffix}?utm_source=t`);
    document.title = `Page ${suffix}`;
    window.dispatchEvent(new Event("sitechat:locationchange"));
  }, pathSuffix);
  const response = await pageViewResponse;
  const body = (await response.json()) as { deduped?: boolean };
  expect(body.deduped).not.toBe(true);
}

async function collectTimelineEventIds(timeline: ReturnType<Page["getByTestId"]>) {
  return timeline
    .getByTestId("customer-timeline-event")
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("data-event-id"))
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
}

/** Newest-first: occurred_at DESC (ties allowed; id tie-break is covered by RPC). */
async function expectTimelineNewestFirst(timeline: ReturnType<Page["getByTestId"]>) {
  const timestamps = await timeline
    .locator("time[datetime]")
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.getAttribute("datetime"))
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );
  expect(timestamps.length).toBeGreaterThan(0);
  for (let i = 1; i < timestamps.length; i += 1) {
    expect(timestamps[i - 1]! >= timestamps[i]!).toBe(true);
  }
}

async function recoverOperatorConversation(page: Page, marker: string) {
  // Offline can leave the thread shell without a visible inbox table. Re-enter
  // from the inbox list so openOperatorConversation can find the row again.
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
  await openOperatorConversation(page, marker);
  await waitForOperatorThreadRealtimeReady(page);
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
    const attachMarker = `timeline-attach-${Date.now()}`;
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

    await expect(timeline.locator('[data-event-type="page_viewed"]').first()).toBeVisible({
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

    // Persist an attachment the same way attachments.spec.ts does: upload → send.
    const frame = widgetFrameLocator(visitor);
    await frame
      .getByTestId("widget-file-input")
      .setInputFiles(path.join(fixturesDir, "sample.pdf"));
    await expect(frame.getByTestId("pending-attachments")).toBeVisible({
      timeout: 15_000,
    });
    await widgetComposer(visitor).fill(attachMarker);
    await frame.getByRole("button", { name: "Send" }).click();
    await expect(
      frame.getByTestId("visitor-message").filter({ hasText: attachMarker }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(frame.getByTestId("attachment-document")).toBeVisible({
      timeout: 60_000,
    });

    await expect(timeline.locator('[data-event-type="attachment_uploaded"]')).toBeVisible({
      timeout: 60_000,
    });

    await operator.reload();
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByTestId("customer-timeline")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      operator.getByTestId("customer-timeline").locator('[data-event-type="conversation_started"]'),
    ).toHaveCount(1);
    await expect(
      operator.getByTestId("customer-timeline").locator('[data-event-type="attachment_uploaded"]'),
    ).toBeVisible({ timeout: 30_000 });

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

    // Seed before the operator mounts the timeline so the first RPC page is
    // full (limit 20) and has_more/next_before are set. Live INSERT fan-out
    // would otherwise inflate local state without refreshing pagination.
    for (let i = 0; i < PAGINATION_PAGE_VIEW_COUNT; i += 1) {
      await recordUniquePageView(visitor, `page-${Date.now()}-${i}`);
    }

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const timeline = operator.getByTestId("customer-timeline");
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    // First page is newest-first (limit 20). Seeded page views push
    // conversation_started onto a later page — wait for page views + Load older.
    await expect(timeline.locator('[data-event-type="page_viewed"]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(async () => timeline.getByTestId("customer-timeline-event").count(), {
        timeout: 60_000,
      })
      .toBe(20);

    const loadOlder = operator.getByTestId("customer-timeline-load-older");
    await expect(loadOlder).toBeVisible({ timeout: 30_000 });

    const firstPageIds = await collectTimelineEventIds(timeline);
    expect(firstPageIds.length).toBe(20);
    expect(new Set(firstPageIds).size).toBe(firstPageIds.length);
    await expectTimelineNewestFirst(timeline);

    await loadOlder.click();

    await expect
      .poll(
        async () => {
          const afterIds = await collectTimelineEventIds(timeline);
          return afterIds.length > firstPageIds.length;
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    const afterIds = await collectTimelineEventIds(timeline);
    expect(afterIds.length).toBeGreaterThan(firstPageIds.length);
    expect(new Set(afterIds).size).toBe(afterIds.length);
    for (const id of firstPageIds) {
      expect(afterIds).toContain(id);
    }
    // Older conversation/message events only appear after the second page loads.
    await expect(timeline.locator('[data-event-type="conversation_started"]')).toBeVisible({
      timeout: 30_000,
    });
    await expectTimelineNewestFirst(timeline);

    await visitorContext.close();
    await operatorContext.close();
  });

  test("reconnect catch-up merges more than one page without gaps or duplicates", async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `timeline-reconnect-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const timeline = operator.getByTestId("customer-timeline");
    await expect(timeline.locator('[data-event-type="conversation_started"]')).toBeVisible({
      timeout: 30_000,
    });

    const beforeOfflineIds = await collectTimelineEventIds(timeline);
    expect(beforeOfflineIds.length).toBeGreaterThan(0);

    // Simulate disconnect so realtime inserts are missed while events still persist.
    await operatorContext.setOffline(true);

    const missedPaths: string[] = [];
    for (let i = 0; i < RECONNECT_MISSED_PAGE_VIEWS; i += 1) {
      const suffix = `offline-${Date.now()}-${i}`;
      missedPaths.push(`/docs/${suffix}`);
      await recordUniquePageView(visitor, suffix);
    }

    await operatorContext.setOffline(false);
    // Offline often leaves the thread shell unable to show the inbox row in place.
    // Remount via inbox so catch-up/load-older can rebuild without gaps.
    await recoverOperatorConversation(operator, marker);

    const recoveredTimeline = operator.getByTestId("customer-timeline");
    await expect(recoveredTimeline).toBeVisible({ timeout: 30_000 });
    await expect(recoveredTimeline.getByTestId("customer-timeline-event").first()).toBeVisible({
      timeout: 60_000,
    });

    // Catch-up (in-place) and/or load-older (after remount) until every offline path is visible.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const missing: string[] = [];
      for (const pathPart of missedPaths) {
        if ((await recoveredTimeline.getByText(pathPart, { exact: false }).count()) === 0) {
          missing.push(pathPart);
        }
      }
      if (missing.length === 0) {
        break;
      }
      const loadOlder = operator.getByTestId("customer-timeline-load-older");
      if ((await loadOlder.count()) === 0) {
        await recoverOperatorConversation(operator, marker);
        continue;
      }
      const beforeIds = await collectTimelineEventIds(recoveredTimeline);
      await loadOlder.click();
      await expect
        .poll(async () => (await collectTimelineEventIds(recoveredTimeline)).length, {
          timeout: 30_000,
        })
        .toBeGreaterThan(beforeIds.length);
    }

    for (const pathPart of missedPaths) {
      await expect(recoveredTimeline.getByText(pathPart, { exact: false }).first()).toBeVisible({
        timeout: 30_000,
      });
    }

    const afterIds = await collectTimelineEventIds(recoveredTimeline);
    expect(new Set(afterIds).size).toBe(afterIds.length);
    expect(afterIds.length).toBeGreaterThanOrEqual(
      beforeOfflineIds.length + RECONNECT_MISSED_PAGE_VIEWS,
    );
    for (const id of beforeOfflineIds) {
      expect(afterIds).toContain(id);
    }
    await expectTimelineNewestFirst(recoveredTimeline);

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
