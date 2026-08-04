import { expect, type Page } from "@playwright/test";

export const HOST_URL = "http://127.0.0.1:3001";
export const APP_URL = "http://127.0.0.1:3000";
export const WORKSPACE_SLUG = "acme-support";
export const OPERATOR_EMAIL = "owner@local.test";
export const OPERATOR_PASSWORD = "local-dev-password";

export async function loginOperator(page: Page) {
  await page.goto(`${APP_URL}/login`);
  await page.getByLabel("Email").fill(OPERATOR_EMAIL);
  await page.getByLabel("Password").fill(OPERATOR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//);
}

export async function openWidget(page: Page) {
  await page.goto(HOST_URL);
  const launcher = page.locator('button[aria-label="Open chat"]');
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.click();
  await expect(page.locator('section[aria-label="Site Chat"]')).toBeVisible({
    timeout: 30_000,
  });
}

export function widgetComposer(page: Page) {
  return page.getByPlaceholder("Type your message…");
}

export function operatorReplyComposer(page: Page) {
  return page.getByPlaceholder("Write a reply...");
}

export async function sendWidgetMessage(page: Page, body: string) {
  const composer = widgetComposer(page);
  await composer.fill(body);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 20_000 });
}

export async function sendOperatorReply(page: Page, body: string) {
  const composer = operatorReplyComposer(page);
  await composer.fill(body);
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 20_000 });
}
