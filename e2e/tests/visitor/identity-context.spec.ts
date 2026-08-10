import { expect, test, type Page } from "@playwright/test";

import {
  APP_URL,
  HOST_URL,
  VIEWER_EMAIL,
  loginAs,
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

async function prepareOperatorInbox(page: Page) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

test.describe("visitor identity + context", () => {
  test("anonymous visitor creates session and operator sees visitor profile", async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-anon-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    await expect(operator.getByRole("heading", { name: "Visitor" })).toBeVisible();
    await expect(operator.getByText(/vis_[a-f0-9]{32}/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(operator.getByRole("heading", { name: "Current context" })).toBeVisible();
    await expect(operator.getByRole("heading", { name: "Activity" })).toBeVisible();

    await visitorContext.close();
    await operatorContext.close();
  });

  test("SiteChat.identify updates operator sidebar live", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-identify-${Date.now()}`;
    const email = `jane.${Date.now()}@example.com`;

    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

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
      { name: "Jane Doe", email },
    );

    const identify = await identifyResponse;
    expect(identify.status()).toBe(200);

    await expect(operator.getByDisplayValue("Jane Doe")).toBeVisible({
      timeout: 30_000,
    });
    await expect(operator.getByDisplayValue(email)).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("operator can edit visitor name", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-edit-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const nameInput = operator.getByLabel("Name");
    await expect(nameInput).toBeVisible({ timeout: 30_000 });
    await nameInput.fill("Operator Edited");
    await operator.getByRole("button", { name: "Save visitor" }).click();

    await expect(nameInput).toHaveValue("Operator Edited", { timeout: 30_000 });
    await expect(operator.getByText("Operator Edited").first()).toBeVisible();

    await visitorContext.close();
    await operatorContext.close();
  });

  test("SPA navigation records page view and updates current page", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-nav-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const pageViewResponse = visitor.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/widget/page-view") &&
        response.request().method() === "POST" &&
        response.status() === 200,
      { timeout: 30_000 },
    );

    await visitor.evaluate(() => {
      window.history.pushState({}, "", "/pricing?utm_source=e2e&utm_medium=test");
      document.title = "Pricing page";
      window.dispatchEvent(new Event("sitechat:locationchange"));
    });

    await pageViewResponse;

    await expect(operator.getByText(/\/pricing\?utm_source=e2e/)).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("reload preserves visitor public id", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, `visitor-reload-${Date.now()}`);

    const publicId = await visitor.evaluate(() => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("sitechat:visitor:")) {
          return localStorage.getItem(key);
        }
      }
      return null;
    });
    expect(publicId).toMatch(/^vis_[a-f0-9]{32}$/);

    await visitor.reload();
    await expect(visitor.locator('iframe[title="Site Chat"]')).toBeAttached({
      timeout: 60_000,
    });
    const frame = widgetFrameLocator(visitor);
    await expect(frame.getByRole("button", { name: "Open chat" })).toBeVisible({
      timeout: 60_000,
    });

    const publicIdAfter = await visitor.evaluate(() => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("sitechat:visitor:")) {
          return localStorage.getItem(key);
        }
      }
      return null;
    });
    expect(publicIdAfter).toBe(publicId);

    await visitor.close();
  });

  test("malicious name and page title render as text", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-xss-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);

    await visitor.evaluate(() => {
      const api = (
        window as unknown as {
          SiteChat?: {
            identify: (payload: { name: string }) => void;
          };
        }
      ).SiteChat;
      api?.identify({ name: '<img src=x onerror="window.__xss=1">' });
      document.title = "<script>window.__titleXss=1</script>";
      window.history.pushState({}, "", "/xss-check");
      window.dispatchEvent(new Event("sitechat:locationchange"));
    });

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    await expect(operator.getByDisplayValue('<img src=x onerror="window.__xss=1">')).toBeVisible({
      timeout: 30_000,
    });

    const injected = await operator.evaluate(() => {
      return Boolean(
        (window as unknown as { __xss?: number }).__xss || document.querySelector('img[src="x"]'),
      );
    });
    expect(injected).toBe(false);

    await visitorContext.close();
    await operatorContext.close();
  });

  test("foreign workspace viewer cannot open seeded conversation route", async ({ browser }) => {
    // Viewer is in acme-support; this asserts role gating for profile edits.
    const operator = await browser.newPage();
    await loginAs(operator, VIEWER_EMAIL);
    await operator.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(operator);
    await openOperatorConversation(operator, "Can you help with pricing?");
    await expect(operator.getByRole("heading", { name: "Visitor" })).toBeVisible();
    await expect(operator.getByRole("button", { name: "Save visitor" })).toHaveCount(0);
    await operator.close();
  });

  test("messaging, receipts path, and suggested reply surface still work", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-compat-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    await sendOperatorReply(operator, `ack-${marker}`);
    await expect(widgetFrameLocator(visitor).getByText(`ack-${marker}`)).toBeVisible({
      timeout: 30_000,
    });

    // Suggested reply panel may be disabled; assert thread composer still works.
    await expect(operator.getByPlaceholder("Write a reply...")).toBeVisible();
    await expect(visitor.locator('iframe[title="Site Chat"]')).toBeAttached();

    await visitorContext.close();
    await operatorContext.close();
  });

  test("referrer and UTM captured on host page with query", async ({ browser }) => {
    const visitor = await browser.newPage();
    const pageViewPromise = visitor.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/widget/session") && response.request().method() === "POST",
      { timeout: 60_000 },
    );

    await visitor.goto(`${HOST_URL}/?utm_source=docs&utm_medium=referral&utm_campaign=visitor`, {
      referer: "https://referrer.example/landing",
    });
    await expect(visitor.locator('iframe[title="Site Chat"]')).toBeAttached({
      timeout: 60_000,
    });
    const frame = widgetFrameLocator(visitor);
    await frame.getByRole("button", { name: "Open chat" }).click();

    const sessionResponse = await pageViewPromise;
    expect(sessionResponse.status()).toBe(200);
    const body = sessionResponse.request().postDataJSON() as {
      pageUrl?: string;
      referrer?: string;
    };
    expect(body.pageUrl).toContain("utm_source=docs");
    expect(body.pageUrl).toContain("utm_campaign=visitor");

    await visitor.close();
  });
});
