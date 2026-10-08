import { expect, test } from "@playwright/test";
import {
  APP_URL,
  loginOperator,
  openOperatorConversation,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
} from "../../helpers";

test("operator workspace keeps navigation, queues and settings usable across screen sizes", async ({
  page,
}) => {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support`);
  await expect(page.getByTestId("overview-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready for an agent" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Unassigned open chats/ }).getByText(/^\d+$/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Your open chats/ }).getByText(/^\d+$/),
  ).toBeVisible();
  await page.getByRole("link", { name: /Unassigned open chats/ }).click();
  await expect(page).toHaveURL(/assignment=unassigned/);
  await expect(page.getByTestId("inbox-queue-pane")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("link", { name: "Inbox", exact: false })
    .click();
  await openOperatorConversation(page, SEEDED_OPEN_CONVERSATION_PREVIEW);
  await expect(page.getByTestId("customer-inspector")).toBeVisible();
  await expect(page.locator(".mill-agent-bubble").first()).toBeVisible();
  if (process.env.MILL_DESIGN_REVIEW_DIR)
    await page.screenshot({ path: `${process.env.MILL_DESIGN_REVIEW_DIR}/inbox-desktop.png` });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByTestId("overview-page")).toBeVisible();
  if (process.env.MILL_DESIGN_REVIEW_DIR)
    await page.screenshot({ path: `${process.env.MILL_DESIGN_REVIEW_DIR}/overview-desktop.png` });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  if (process.env.MILL_DESIGN_REVIEW_DIR)
    await page.screenshot({ path: `${process.env.MILL_DESIGN_REVIEW_DIR}/settings-desktop.png` });
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByTestId("settings-link-install")).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(page.getByTestId("overview-page")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  if (process.env.MILL_DESIGN_REVIEW_DIR)
    await page.screenshot({ path: `${process.env.MILL_DESIGN_REVIEW_DIR}/overview-mobile.png` });
});
