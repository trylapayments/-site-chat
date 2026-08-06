import { expect, type FrameLocator, type Page } from "@playwright/test";

export const HOST_URL = "http://localhost:3001";
export const APP_URL = "http://localhost:3000";
export const WORKSPACE_SLUG = "acme-support";
export const OPERATOR_EMAIL = "owner@local.test";
export const OPERATOR_PASSWORD = "local-dev-password";

export async function loginOperator(page: Page) {
  await page.goto(`${APP_URL}/login`);
  await page.getByLabel("Email").fill(OPERATOR_EMAIL);
  await page.getByLabel("Password").fill(OPERATOR_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/app\//, { timeout: 60_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
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
  await Promise.all([
    page.waitForURL(/\/inbox\/[0-9a-f-]+/, { timeout: 60_000 }),
    row.getByRole("link").first().click(),
  ]);
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
