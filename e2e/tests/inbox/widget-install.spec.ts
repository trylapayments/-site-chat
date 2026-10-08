import { expect, test } from "@playwright/test";
import { APP_URL, WORKSPACE_SLUG, loginOperator, loginAs, AGENT_EMAIL } from "../../helpers";

test("website installation controls exact allowed domains and revokes bootstrap access", async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const host = `install-${Date.now()}.example.com`;
  let key = "";
  try {
    await loginOperator(page);
    await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings`);
    await page.getByRole("link", { name: /Install widget/ }).click();
    const code = page.getByLabel("Your widget code");
    const snippet = await code.inputValue();
    key = snippet.match(/data-widget-key="([^"]+)"/)?.[1] ?? "";
    expect(key).toMatch(/^wk_[a-f0-9]{32}$/);
    expect(snippet).toContain(`${APP_URL}/widget/loader.js`);
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Widget code copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(snippet);
    const bootstrap = (origin: string) =>
      context.request.get(`${APP_URL}/api/v1/widget/bootstrap?key=${key}`, {
        headers: { Origin: origin },
      });
    expect((await bootstrap(`https://${host}`)).status()).toBe(403);
    await page.getByLabel("Website domain").fill(host);
    await page.getByRole("button", { name: "Allow domain", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(`${host} is allowed.`);
    expect((await bootstrap(`https://${host}`)).status()).toBe(200);
    expect((await bootstrap(`https://www.${host}`)).status()).toBe(403);
    expect((await bootstrap(`https://${host}.evil.com`)).status()).toBe(403);
    await page.screenshot({
      path: test.info().outputPath("widget-install-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: test.info().outputPath("widget-install-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: `Block ${host}`, exact: true }).click();
    await expect(page.getByRole("status")).toContainText(`${host} is blocked.`);
    expect((await bootstrap(`https://${host}`)).status()).toBe(403);
    await page.reload();
    await expect(page.getByRole("button", { name: `Allow ${host}`, exact: true })).toBeVisible();
  } finally {
    const block = page.getByRole("button", { name: `Block ${host}`, exact: true });
    if (await block.isVisible()) await block.click();
    await context.close();
  }
});

test("agents can copy installation code but cannot change domain access", async ({ page }) => {
  await loginAs(page, AGENT_EMAIL);
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/install`);
  await expect(page.getByLabel("Your widget code")).toBeVisible();
  await expect(page.getByLabel("Website domain")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Allow domain", exact: true })).toHaveCount(0);
});
