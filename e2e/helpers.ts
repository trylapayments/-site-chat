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

export async function openWidget(page: Page) {
  await page.goto(HOST_URL);
  await expect(page.locator('iframe[title="Site Chat"]')).toBeAttached({
    timeout: 60_000,
  });

  const frame = widgetFrame(page);
  const launcher = frame.getByRole("button", { name: "Open chat" });
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await launcher.click();
  await expect(frame.locator('section[aria-label="Site Chat"]')).toBeVisible({
    timeout: 60_000,
  });
}

export function widgetComposer(page: Page) {
  return widgetFrame(page).getByPlaceholder("Type your message…");
}

export function operatorReplyComposer(page: Page) {
  return page.getByPlaceholder("Write a reply...");
}

export async function sendWidgetMessage(page: Page, body: string) {
  const frame = widgetFrame(page);
  const composer = widgetComposer(page);
  await composer.fill(body);
  await frame.getByRole("button", { name: "Send" }).click();
  await expect(frame.getByText(body)).toBeVisible({ timeout: 30_000 });
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
