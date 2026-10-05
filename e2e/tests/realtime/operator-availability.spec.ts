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

test("auto-away is configurable and activity restores only automatic Away", async ({ browser }) => {
  test.setTimeout(180_000);
  const operatorContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  const visitor = await visitorContext.newPage();
  try {
    await loginOperator(operator);
    await operator.goto(`${APP_URL}/app/acme-support/inbox`);
    const availability = operator.getByRole("combobox", { name: "Your availability" });
    await expect(availability).toBeEnabled({ timeout: 15_000 });
    await operator.getByRole("button", { name: "Auto-away settings", exact: true }).click();
    const inactivity = operator.getByRole("combobox", { name: "Auto-away after inactivity" });
    await inactivity.selectOption("1");
    await expect(inactivity).toHaveValue("1");
    await expect(availability).toBeEnabled();
    await availability.selectOption("available");
    await expect(availability).toHaveValue("available");
    await openWidget(visitor);
    const presence = widgetFrameLocator(visitor).getByTestId("widget-operator-presence");
    await expect(presence).toHaveAttribute("data-presence", "online", { timeout: 30_000 });
    // No operator interactions: the real server clock drives the idle threshold.
    await expect(presence).toHaveAttribute("data-presence", "away", { timeout: 90_000 });
    await expect(availability).toHaveValue("auto-away", { timeout: 20_000 });
    await operator.getByRole("heading", { name: "Inbox", exact: true }).click();
    await expect(availability).toHaveValue("available", { timeout: 20_000 });
    await expect(presence).toHaveAttribute("data-presence", "online", { timeout: 30_000 });
    await availability.selectOption("away");
    await expect(availability).toHaveValue("away");
    await operator.getByRole("heading", { name: "Inbox", exact: true }).click();
    await expect(presence).toHaveAttribute("data-presence", "away", { timeout: 30_000 });
    await expect(availability).toHaveValue("away");
  } finally {
    const availability = operator.getByRole("combobox", { name: "Your availability" });
    if (await availability.isVisible()) {
      await expect(availability).toBeEnabled();
      const inactivity = operator.getByRole("combobox", { name: "Auto-away after inactivity" });
      if (!(await inactivity.isVisible()))
        await operator.getByRole("button", { name: "Auto-away settings", exact: true }).click();
      await inactivity.selectOption("5");
      await expect(inactivity).toHaveValue("5");
      await expect(availability).toBeEnabled();
      await availability.selectOption("offline");
    }
    await operatorContext.close();
    await visitorContext.close();
  }
});
