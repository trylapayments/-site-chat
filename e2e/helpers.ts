import { expect, type FrameLocator, type Page } from "@playwright/test";

export const HOST_URL = "http://localhost:3001";
export const APP_URL = "http://localhost:3000";
export const WORKSPACE_SLUG = "acme-support";
export const OPERATOR_EMAIL = "owner@local.test";
export const ADMIN_EMAIL = "admin@local.test";
export const AGENT_EMAIL = "agent@local.test";
export const VIEWER_EMAIL = "viewer@local.test";
export const OPERATOR_PASSWORD = "local-dev-password";
export const SEEDED_OPEN_CONVERSATION_PREVIEW = "Can you help with pricing?";

export async function loginAs(page: Page, email: string, password = OPERATOR_PASSWORD) {
  await page.goto(`${APP_URL}/login`);
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL(/\/app\//, { timeout: 60_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  // Ensure the post-auth redirect landed in the app shell before callers navigate.
  await expect(page).toHaveURL(/\/app\//);
}

export async function loginOperator(page: Page) {
  await loginAs(page, OPERATOR_EMAIL);
}

function widgetFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Site Chat"]');
}

function isBootstrapRequest(url: string, method: string) {
  return url.includes("/api/v1/widget/bootstrap") && method === "GET";
}

export async function waitForWidgetRealtimeReady(page: Page) {
  await expect(widgetFrame(page).getByTestId("widget-realtime-ready")).toHaveAttribute(
    "data-realtime-state",
    "connected",
    { timeout: 60_000 },
  );
}

export async function waitForOperatorThreadRealtimeReady(page: Page) {
  await expect(page.getByTestId("thread-realtime-ready")).toHaveAttribute(
    "data-realtime-state",
    "connected",
    { timeout: 60_000 },
  );
}

export async function waitForOperatorInboxRealtimeReady(page: Page) {
  await expect(page.getByTestId("inbox-realtime-ready")).toHaveAttribute(
    "data-realtime-state",
    "connected",
    { timeout: 60_000 },
  );
}

export async function openWidget(page: Page) {
  const loaderLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/widget/loader.js") &&
      response.request().method() === "GET" &&
      response.status() === 200,
    { timeout: 60_000 },
  );
  const bootstrapResponse = page.waitForResponse(
    (response) => isBootstrapRequest(response.url(), response.request().method()),
    { timeout: 60_000 },
  );

  await page.goto(HOST_URL);
  await loaderLoaded;
  const bootstrap = await bootstrapResponse;
  expect(bootstrap.status(), `widget bootstrap failed with HTTP ${bootstrap.status()}`).toBe(200);

  await expect(page.locator('iframe[title="Site Chat"]')).toBeAttached({
    timeout: 10_000,
  });

  const frame = widgetFrame(page);
  const launcher = frame.getByRole("button", { name: "Open chat" });
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await launcher.click();
  await expect(frame.getByTestId("widget-realtime-ready")).toBeVisible({
    timeout: 60_000,
  });
  await expect(widgetComposer(page)).toBeVisible({ timeout: 60_000 });
}

export function widgetComposer(page: Page) {
  return widgetFrame(page).getByPlaceholder("Type your message…");
}

export function operatorReplyComposer(page: Page) {
  return page.getByPlaceholder("Write a reply...");
}

export async function openOperatorConversation(page: Page, previewText: string) {
  const row = page.getByRole("row").filter({ hasText: previewText });
  await expect(row).toBeVisible({ timeout: 60_000 });
  const href = await row.getByRole("link").first().getAttribute("href");
  if (!href) {
    throw new Error(`Conversation link missing for preview: ${previewText}`);
  }
  // Full navigation is more reliable than soft-click under `next start` CI:
  // Promise.all(waitForURL + click) can resolve while the inbox shell remains.
  const target = href.startsWith("http") ? href : `${APP_URL}${href}`;
  await page.goto(target);
  await expect(page).toHaveURL(/\/inbox\/[0-9a-f-]{36}/i, { timeout: 60_000 });
  await expect(page.getByTestId("conversation-main-tabs")).toBeVisible({
    timeout: 60_000,
  });
}

export async function sendWidgetMessage(page: Page, body: string) {
  const frame = widgetFrame(page);
  const composer = widgetComposer(page);
  await composer.fill(body);
  await frame.getByRole("button", { name: "Send" }).click();
  await expect(frame.getByRole("article").getByText(body)).toBeVisible({
    timeout: 30_000,
  });
}

export async function sendOperatorReply(page: Page, body: string) {
  const composer = operatorReplyComposer(page);
  await composer.fill(body);
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 30_000 });
}

export function widgetFrameLocator(page: Page): FrameLocator {
  return widgetFrame(page);
}
