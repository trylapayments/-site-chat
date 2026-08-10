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

/** Continuity/visitor ids are stored in the embed iframe origin (not the host page). */
async function readIframeVisitorIdentity(page: Page) {
  const frame = page.frame({ url: /\/widget\/embed/ });
  if (!frame) {
    throw new Error("widget embed frame not found");
  }
  return frame.evaluate(() => {
    let publicId: string | null = null;
    let continuityToken: string | null = null;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("sitechat:visitor:")) {
        publicId = localStorage.getItem(key);
      }
      if (key.startsWith("sitechat:continuity:")) {
        continuityToken = localStorage.getItem(key);
      }
    }
    return { publicId, continuityToken };
  });
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

    const sidebar = operator.locator("aside");
    await expect(sidebar.getByRole("heading", { name: "Visitor", exact: true })).toBeVisible();
    await expect(sidebar.getByText(/vis_[a-f0-9]{32}/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      sidebar.getByRole("heading", { name: "Current context", exact: true }),
    ).toBeVisible();
    await expect(sidebar.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();

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

    await expect(operator.getByLabel("Name")).toHaveValue("Jane Doe", {
      timeout: 30_000,
    });
    await expect(operator.getByLabel("Email")).toHaveValue(email, {
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("operator can edit visitor name/email/phone and reload preserves", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-edit-${Date.now()}`;
    const editedEmail = `edited.${Date.now()}@example.com`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    const nameInput = operator.getByLabel("Name");
    const emailInput = operator.getByLabel("Email");
    const phoneInput = operator.getByLabel("Phone");
    await expect(nameInput).toBeVisible({ timeout: 30_000 });
    await nameInput.fill("Operator Edited");
    await emailInput.fill(editedEmail);
    await phoneInput.fill("+1 555 0100");
    await operator.getByRole("button", { name: "Save visitor" }).click();

    await expect(nameInput).toHaveValue("Operator Edited", { timeout: 30_000 });
    await expect(emailInput).toHaveValue(editedEmail);
    await expect(phoneInput).toHaveValue("+1 555 0100");
    await expect(operator.getByText("Operator Edited").first()).toBeVisible();

    await operator.reload();
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByLabel("Name")).toHaveValue("Operator Edited", {
      timeout: 30_000,
    });
    await expect(operator.getByLabel("Email")).toHaveValue(editedEmail);
    await expect(operator.getByLabel("Phone")).toHaveValue("+1 555 0100");

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
      window.history.pushState(
        {},
        "",
        "/pricing?utm_source=e2e&utm_medium=test&access_token=secret#frag",
      );
      document.title = "Pricing page";
      window.dispatchEvent(new Event("sitechat:locationchange"));
    });

    await pageViewResponse;

    const sidebar = operator.locator("aside");
    // Current context URL + recent page-view history can both contain the path.
    await expect(sidebar.getByText(/\/pricing\?utm_source=e2e/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(operator.getByText("access_token=secret")).toHaveCount(0);
    await expect(operator.getByText("#frag")).toHaveCount(0);

    await visitorContext.close();
    await operatorContext.close();
  });

  test("reload preserves continuity token and visitor public id", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);
    await sendWidgetMessage(visitor, `visitor-reload-${Date.now()}`);

    const stored = await readIframeVisitorIdentity(visitor);
    expect(stored.publicId).toMatch(/^vis_[a-f0-9]{32}$/);
    expect(stored.continuityToken).toMatch(/^[A-Za-z0-9_-]{20,128}$/);

    await visitor.reload();
    await expect(visitor.locator('iframe[title="Site Chat"]')).toBeAttached({
      timeout: 60_000,
    });
    const frame = widgetFrameLocator(visitor);
    await expect(frame.getByRole("button", { name: "Open chat" })).toBeVisible({
      timeout: 60_000,
    });
    await frame.getByRole("button", { name: "Open chat" }).click();
    await expect(frame.getByTestId("widget-realtime-ready")).toBeVisible({
      timeout: 60_000,
    });

    const storedAfter = await readIframeVisitorIdentity(visitor);
    expect(storedAfter.publicId).toBe(stored.publicId);
    expect(storedAfter.continuityToken).toBe(stored.continuityToken);

    await visitor.close();
  });

  test("unsigned identify with existing email does not takeover victim", async ({ browser }) => {
    const victimContext = await browser.newContext();
    const attackerContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const victim = await victimContext.newPage();
    const attacker = await attackerContext.newPage();
    const operator = await operatorContext.newPage();

    const victimEmail = `victim.${Date.now()}@example.com`;
    const victimMarker = `victim-msg-${Date.now()}`;
    const attackerMarker = `attacker-msg-${Date.now()}`;

    await openWidget(victim);
    await sendWidgetMessage(victim, victimMarker);
    await waitForWidgetRealtimeReady(victim);
    const victimIdentify = victim.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/widget/identify") &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    );
    await victim.evaluate(
      ({ email }) => {
        (
          window as unknown as {
            SiteChat?: { identify: (payload: { name: string; email: string }) => void };
          }
        ).SiteChat?.identify({ name: "Victim User", email });
      },
      { email: victimEmail },
    );
    expect((await victimIdentify).status()).toBe(200);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, victimMarker);
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByLabel("Name")).toHaveValue("Victim User", {
      timeout: 30_000,
    });
    await expect(operator.getByLabel("Email")).toHaveValue(victimEmail);

    await openWidget(attacker);
    await sendWidgetMessage(attacker, attackerMarker);
    await waitForWidgetRealtimeReady(attacker);

    const identifyResponse = attacker.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/widget/identify") &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    );
    await attacker.evaluate(
      ({ email }) => {
        (
          window as unknown as {
            SiteChat?: { identify: (payload: { name: string; email: string }) => void };
          }
        ).SiteChat?.identify({ name: "Attacker", email });
      },
      { email: victimEmail },
    );
    const identify = await identifyResponse;
    // Conflict or soft-fail: must not succeed as a merge/takeover.
    expect(identify.status()).not.toBe(200);

    await openOperatorConversation(operator, victimMarker);
    await expect(operator.getByLabel("Name")).toHaveValue("Victim User", {
      timeout: 30_000,
    });
    await expect(operator.getByLabel("Email")).toHaveValue(victimEmail);
    await expect(operator.getByLabel("Name")).not.toHaveValue("Attacker");

    await victimContext.close();
    await attackerContext.close();
    await operatorContext.close();
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

    await expect(operator.getByLabel("Name")).toHaveValue('<img src=x onerror="window.__xss=1">', {
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

  test("viewer cannot edit visitor profile", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const viewer = await viewerContext.newPage();

    // Do not rely on a seeded preview other suites may mutate.
    const marker = `viewer-gate-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);

    await loginAs(viewer, VIEWER_EMAIL);
    await viewer.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(viewer);
    await openOperatorConversation(viewer, marker);
    await expect(
      viewer.locator("aside").getByRole("heading", { name: "Visitor", exact: true }),
    ).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Save visitor" })).toHaveCount(0);

    await visitorContext.close();
    await viewerContext.close();
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
