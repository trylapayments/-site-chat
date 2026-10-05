import { expect, test } from "@playwright/test";
import {
  APP_URL,
  WORKSPACE_SLUG,
  loginOperator,
  HOST_URL,
  widgetFrameLocator,
} from "../../helpers";
import { mkdir } from "node:fs/promises";
const shots =
  "/Users/antonlevy/Documents/Codex/2026-10-03/users-antonlevy-downloads-site-chat-e2e/outputs/mill-billing-review";
test("company profile and Billing are usable", async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/company`);
  await expect(page.getByRole("heading", { name: "Company", exact: true })).toBeVisible();
  await page.screenshot({ path: `${shots}/company.png`, fullPage: true });
  await page.getByRole("button", { name: "Save company details" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/billing`);
  await expect(page.getByTestId("billing-page")).toBeVisible();
  await expect(page.getByText("No invoices yet.", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${shots}/billing.png`, fullPage: true });
});
test("desktop rectangle and mobile circle survive publication and host resize", async ({
  page,
  browser,
}) => {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/widget-studio`);
  page.once("dialog", (d) => {
    void d.accept();
  });
  await page.getByTestId("widget-studio-reset").click();
  await expect(page.getByText("Draft reset to defaults.", { exact: true })).toBeVisible();
  if (await page.getByTestId("widget-studio-publish").isEnabled()) {
    await page.getByTestId("widget-studio-publish").click();
    await expect(page.getByText("Published to production.", { exact: true })).toBeVisible();
  }
  await page.getByLabel("Shape", { exact: true }).selectOption("rectangle");
  await page.getByLabel("Button label", { exact: true }).fill("Online chat");
  await page.getByLabel("Button width", { exact: true }).fill("220");
  for (const section of await page.getByTestId("widget-studio-advanced-section").all())
    await section.locator("summary").click();
  await page.getByLabel("Use different launcher on mobile", { exact: true }).check();
  await page.getByLabel("Mobile shape", { exact: true }).selectOption("circle");
  await page.getByLabel("Mobile position", { exact: true }).selectOption("bottom-left");
  await page.getByTestId("widget-studio-preview-launcher").click();
  await page.screenshot({ path: `${shots}/launcher-settings.png`, fullPage: true });
  await page.getByTestId("widget-studio-save-draft").click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByTestId("widget-studio-publish").click();
  await expect(page.getByText("Published to production.", { exact: true })).toBeVisible();
  const client = await browser.newPage();
  await client.goto(HOST_URL);
  const frame = widgetFrameLocator(client);
  const launcher = frame.getByRole("button", { name: "Open chat", exact: true });
  await expect(launcher).toBeVisible();
  await expect(launcher).toContainText("Online chat");
  await expect(launcher).toHaveCSS("width", "220px");
  await client.setViewportSize({ width: 390, height: 844 });
  await expect(launcher).toHaveCSS("width", "56px");
  await expect(launcher).toHaveCSS("left", "16px");
  await client.screenshot({ path: `${shots}/mobile-launcher.png` });
  await client.setViewportSize({ width: 1280, height: 800 });
  await expect(launcher).toHaveCSS("width", "220px");
  await client.close();
  page.once("dialog", (d) => {
    void d.accept();
  });
  await page.getByTestId("widget-studio-reset").click();
  await expect(page.getByText("Draft reset to defaults.", { exact: true })).toBeVisible();
  await page.getByTestId("widget-studio-publish").click();
  await expect(page.getByText("Published to production.", { exact: true })).toBeVisible();
});
