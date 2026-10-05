import { expect, test } from "@playwright/test";
import { openWidget, widgetFrameLocator } from "../../helpers";

test("Mill branding is centered and opens its website from the embedded widget", async ({
  page,
  context,
}) => {
  await context.route("https://mill.chat/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Mill</title><h1>Mill website</h1>" }),
  );
  await openWidget(page);
  const frame = widgetFrameLocator(page);
  const branding = frame.getByRole("link", { name: "Powered by Mill", exact: true });
  await expect(branding).toHaveAttribute("href", "https://mill.chat");
  await expect(branding).toHaveAttribute("rel", "noopener noreferrer");
  await expect(branding.locator("img")).toHaveCount(1);
  await expect
    .poll(() =>
      branding.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const alignment = await branding.evaluate((node) => {
    const link = node.getBoundingClientRect();
    const footer = node.closest("footer")!.getBoundingClientRect();
    return Math.abs(link.x + link.width / 2 - footer.x - footer.width / 2);
  });
  expect(alignment).toBeLessThan(2);
  await page
    .locator('iframe[title="Mill"]')
    .screenshot({ path: test.info().outputPath("mill-brand-widget-mobile.png") });
  const popupPromise = context.waitForEvent("page");
  await branding.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://mill.chat/");
  await expect(popup.getByRole("heading", { name: "Mill website" })).toBeVisible();
  await popup.close();
  await frame.getByRole("button", { name: "Close chat", exact: true }).click();
  const launcher = frame.getByRole("button", { name: "Open chat", exact: true });
  await expect(launcher.locator("svg path")).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("mill-brand-launcher.png") });
});
