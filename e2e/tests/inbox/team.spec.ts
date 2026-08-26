import { expect, test } from "@playwright/test";

import {
  ADMIN_EMAIL,
  AGENT_EMAIL,
  APP_URL,
  loginAs,
  loginOperator,
  VIEWER_EMAIL,
  WORKSPACE_SLUG,
} from "../../helpers";

const TEAM_URL = `${APP_URL}/app/${WORKSPACE_SLUG}/team`;

test.describe("team workspace", () => {
  test("owner sees members, pending invite, and invite action", async ({ page }) => {
    await loginOperator(page);
    await page.goto(TEAM_URL);
    await expect(page.getByTestId("team-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByTestId("team-table")).toBeVisible();
    await expect(page.getByText("owner@local.test").first()).toBeVisible();
    await expect(page.getByText("admin@local.test").first()).toBeVisible();
    await expect(page.getByText("agent@local.test").first()).toBeVisible();
    await expect(page.getByText("viewer@local.test").first()).toBeVisible();
    await expect(page.getByText("invitee@local.test").first()).toBeVisible();
    await expect(page.getByText("Invited").first()).toBeVisible();
    await expect(page.getByTestId("team-invite-button")).toBeVisible();
  });

  test("owner can create and cancel a pending invitation", async ({ page }) => {
    test.setTimeout(90_000);
    const email = `team-e2e-${Date.now()}@local.test`;
    await loginOperator(page);
    await page.goto(TEAM_URL);
    await expect(page.getByTestId("team-invite-button")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("team-invite-button").click();
    await expect(page.getByTestId("team-invite-sheet")).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Role").selectOption("agent");
    await page.getByRole("button", { name: "Create invitation" }).click();
    await expect(page.getByText("Invitation created")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(email).first()).toBeVisible();

    await page
      .getByRole("row")
      .filter({ hasText: email })
      .getByRole("button", { name: /Actions for/ })
      .click();
    await page.getByRole("menuitem", { name: "Cancel invitation" }).click();
    await page.getByRole("button", { name: "Cancel invitation" }).click();
    await expect(page.getByText("Invitation cancelled")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(email)).toHaveCount(0);
  });

  test("agent can view the team but cannot invite", async ({ page }) => {
    await loginAs(page, AGENT_EMAIL);
    await page.goto(TEAM_URL);
    await expect(page.getByTestId("team-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("team-table")).toBeVisible();
    await expect(page.getByTestId("team-invite-button")).toHaveCount(0);
    await expect(
      page.getByText("Inviting and role changes require an admin or owner"),
    ).toBeVisible();
  });

  test("viewer can view the team but cannot invite", async ({ page }) => {
    await loginAs(page, VIEWER_EMAIL);
    await page.goto(TEAM_URL);
    await expect(page.getByTestId("team-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("team-invite-button")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("admin can open member detail without owner-destructive actions on the owner", async ({
    page,
  }) => {
    await loginAs(page, ADMIN_EMAIL);
    await page.goto(TEAM_URL);
    await expect(page.getByTestId("team-page")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Owner/ }).first().click();
    await expect(page.getByTestId("team-member-sheet")).toBeVisible();
    await expect(page.getByText("Only another owner can change this membership.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove from workspace" })).toHaveCount(0);
  });
});
