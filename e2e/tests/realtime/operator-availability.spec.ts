import { expect, test } from "@playwright/test";
import { APP_URL, loginOperator, openWidget, widgetFrameLocator } from "../../helpers";

test("workspace availability reaches a visitor before an operator joins their conversation", async ({
  browser,
}) => {
  const operatorContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  const visitor = await visitorContext.newPage();
  try {
    await loginOperator(operator);
    await operator.goto(`${APP_URL}/app/acme-support/inbox`);
    const availability = operator.getByRole("combobox", { name: "Your availability" });
    await expect(availability).toBeEnabled({ timeout: 15_000 });
    await availability.selectOption("available");
    await expect(availability).toHaveValue("available");
    await openWidget(visitor);
    const presence = widgetFrameLocator(visitor).getByTestId("widget-operator-presence");
    await expect(presence).toHaveAttribute("data-presence", "online", { timeout: 30_000 });
    await availability.selectOption("away");
    await expect(presence).toHaveAttribute("data-presence", "away", { timeout: 30_000 });
    await availability.selectOption("offline");
    await expect(presence).toHaveAttribute("data-presence", "offline", { timeout: 30_000 });
  } finally {
    const availability = operator.getByRole("combobox", { name: "Your availability" });
    if (await availability.isVisible()) {
      await expect(availability).toBeEnabled();
      await availability.selectOption("offline");
    }
    await operatorContext.close();
    await visitorContext.close();
  }
});
