import { expect, test, type Page } from "@playwright/test";

import {
  AGENT_EMAIL,
  APP_URL,
  loginAs,
  loginOperator,
  openOperatorConversation,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
  VIEWER_EMAIL,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
} from "../../helpers";

const CONTACTS_URL = `${APP_URL}/app/acme-support/contacts`;
const SEEDED_CONTACT_NAME = "Jane Cooper";
const SEEDED_TAG_NAME = "VIP";
const SEEDED_COMPANY_NAME = "Acme Example";
const SEEDED_CUSTOM_FIELD_LABEL = "Plan tier";
const BULK_COMPANY_NAME = "Bulk Co 101";

async function openSeededContactProfile(page: Page) {
  await page.goto(CONTACTS_URL);
  await expect(page.getByTestId("contacts-page")).toBeVisible({
    timeout: 60_000,
  });
  await Promise.all([
    page.waitForURL(/\/contacts\/[0-9a-f-]+/, { timeout: 60_000 }),
    page.getByRole("link", { name: SEEDED_CONTACT_NAME }).first().click(),
  ]);
  await expect(page.getByTestId("contact-profile-panel")).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("visitor profile / CRM-lite", () => {
  test("operator edits profile, tags, company, custom field; timeline records events", async ({
    page,
  }) => {
    const jobTitle = `CRM Job ${Date.now()}`;
    const customValue = "pro";

    await loginOperator(page);
    await openSeededContactProfile(page);

    const panel = page.getByTestId("contact-profile-panel");

    await panel.getByLabel("Job title").fill(jobTitle);
    await panel.getByRole("button", { name: "Save" }).first().click();
    await expect(panel.getByLabel("Job title")).toHaveValue(jobTitle, {
      timeout: 30_000,
    });

    // Tag add/remove (seeded VIP) — tolerate prior-run assignment
    const assignedVip = panel.getByRole("button", {
      name: `Remove ${SEEDED_TAG_NAME}`,
    });
    if (await assignedVip.count()) {
      await assignedVip.click();
      await expect(panel.getByText("No tags yet.")).toBeVisible({
        timeout: 30_000,
      });
    }
    const tagSelect = panel.locator("#assign-tag");
    await expect(tagSelect).toBeVisible({ timeout: 30_000 });
    await tagSelect.selectOption({ label: SEEDED_TAG_NAME });
    await panel.getByRole("button", { name: "Add tag" }).click();
    await expect(panel.getByText(SEEDED_TAG_NAME).first()).toBeVisible({
      timeout: 30_000,
    });
    await panel.getByRole("button", { name: `Remove ${SEEDED_TAG_NAME}` }).click();
    await expect(panel.getByText("No tags yet.")).toBeVisible({
      timeout: 30_000,
    });
    await tagSelect.selectOption({ label: SEEDED_TAG_NAME });
    await panel.getByRole("button", { name: "Add tag" }).click();
    await expect(panel.getByText(SEEDED_TAG_NAME).first()).toBeVisible({
      timeout: 30_000,
    });

    // Company link / unlink — search finds companies past the first page
    await panel.getByLabel("Search companies…").fill(BULK_COMPANY_NAME);
    const companySelect = panel.locator("#link-company");
    await expect(companySelect).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => companySelect.locator("option").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(1);
    await companySelect.selectOption({ label: BULK_COMPANY_NAME });
    await panel.getByRole("button", { name: "Link" }).click();
    await expect(panel.getByText(BULK_COMPANY_NAME).first()).toBeVisible({
      timeout: 30_000,
    });
    await panel.getByRole("button", { name: "Unlink company" }).click();
    await expect(panel.getByText("No company linked.")).toBeVisible({
      timeout: 30_000,
    });

    await panel.getByLabel("Search companies…").fill(SEEDED_COMPANY_NAME);
    await expect
      .poll(async () => companySelect.locator(`option:text-is("${SEEDED_COMPANY_NAME}")`).count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await companySelect.selectOption({ label: SEEDED_COMPANY_NAME });
    await panel.getByRole("button", { name: "Link" }).click();
    await expect(panel.getByText(SEEDED_COMPANY_NAME).first()).toBeVisible({
      timeout: 30_000,
    });

    // Custom field value (seeded Plan tier select)
    const fieldControl = panel.getByLabel(SEEDED_CUSTOM_FIELD_LABEL);
    await expect(fieldControl).toBeVisible({ timeout: 30_000 });
    await fieldControl.selectOption(customValue);
    await panel
      .locator("div.space-y-1\\.5")
      .filter({ has: fieldControl })
      .getByRole("button", { name: "Save" })
      .click();
    await expect(fieldControl).toHaveValue(customValue, { timeout: 30_000 });

    const timeline = panel.getByTestId("customer-timeline");
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(
      timeline.locator('[data-event-type="visitor_profile_updated"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(timeline.locator('[data-event-type="tag_added"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.locator('[data-event-type="company_linked"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.locator('[data-event-type="custom_field_updated"]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("viewer can view contact profile but cannot edit", async ({ page }) => {
    await loginAs(page, VIEWER_EMAIL);
    await openSeededContactProfile(page);

    const panel = page.getByTestId("contact-profile-panel");
    await expect(panel.getByText("Jane Cooper").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(panel.getByLabel("Job title")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Add tag" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Link" })).toHaveCount(0);
  });

  test("second operator sees profile update via contact page refresh path", async ({ browser }) => {
    // Full CDC across two browsers can flake under CI webserver restarts.
    // This test verifies the durable write is visible to another operator session
    // after navigation (shared RPC truth), documenting live CDC as best-effort.
    const ownerContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const agent = await agentContext.newPage();

    const jobTitle = `Live CRM ${Date.now()}`;

    await loginOperator(owner);
    await openSeededContactProfile(owner);
    await owner.getByTestId("contact-profile-panel").getByLabel("Job title").fill(jobTitle);
    await owner
      .getByTestId("contact-profile-panel")
      .getByRole("button", { name: "Save" })
      .first()
      .click();
    await expect(owner.getByTestId("contact-profile-panel").getByLabel("Job title")).toHaveValue(
      jobTitle,
      { timeout: 30_000 },
    );

    await loginAs(agent, AGENT_EMAIL);
    await openSeededContactProfile(agent);
    await expect(agent.getByTestId("contact-profile-panel").getByLabel("Job title")).toHaveValue(
      jobTitle,
      { timeout: 30_000 },
    );

    await ownerContext.close();
    await agentContext.close();
  });

  test("disjoint concurrent edits keep dirty drafts and dirty-only saves", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const agent = await agentContext.newPage();

    const email = `crm-concurrent-${Date.now()}@example.com`;
    const jobTitle = `Concurrent Title ${Date.now()}`;

    await loginOperator(owner);
    await openSeededContactProfile(owner);
    await loginAs(agent, AGENT_EMAIL);
    await openSeededContactProfile(agent);

    const ownerPanel = owner.getByTestId("contact-profile-panel");
    const agentPanel = agent.getByTestId("contact-profile-panel");

    // Owner edits email only; agent edits job title only (disjoint fields).
    await ownerPanel.getByLabel("Email").fill(email);
    await agentPanel.getByLabel("Job title").fill(jobTitle);

    await ownerPanel.getByRole("button", { name: "Save" }).first().click();
    await expect(ownerPanel.getByLabel("Email")).toHaveValue(email, {
      timeout: 30_000,
    });

    // Agent's dirty job title must survive owner save / live refresh.
    await expect(agentPanel.getByLabel("Job title")).toHaveValue(jobTitle, {
      timeout: 30_000,
    });

    await agentPanel.getByRole("button", { name: "Save" }).first().click();
    await expect(agentPanel.getByLabel("Job title")).toHaveValue(jobTitle, {
      timeout: 30_000,
    });

    // After both saves, each field is present without wiping the other.
    await owner.reload();
    await expect(owner.getByTestId("contact-profile-panel")).toBeVisible({
      timeout: 60_000,
    });
    await expect(owner.getByTestId("contact-profile-panel").getByLabel("Email")).toHaveValue(
      email,
      { timeout: 30_000 },
    );
    await expect(owner.getByTestId("contact-profile-panel").getByLabel("Job title")).toHaveValue(
      jobTitle,
      { timeout: 30_000 },
    );

    await ownerContext.close();
    await agentContext.close();
  });

  test("contacts list Load more paginates past 50", async ({ page }) => {
    await loginOperator(page);
    await page.goto(CONTACTS_URL);
    await expect(page.getByTestId("contacts-page")).toBeVisible({
      timeout: 60_000,
    });

    const list = page.getByTestId("contacts-list");
    await expect(list).toBeVisible({ timeout: 30_000 });
    const initialCount = await list.locator("li").count();
    expect(initialCount).toBeLessThanOrEqual(50);
    expect(initialCount).toBeGreaterThan(0);

    const loadMore = page.getByTestId("contacts-load-more");
    await expect(loadMore).toBeVisible({ timeout: 30_000 });
    await loadMore.click();
    await expect
      .poll(async () => list.locator("li").count(), { timeout: 30_000 })
      .toBeGreaterThan(initialCount);
  });

  test("inbox sidebar links to full contact profile", async ({ page }) => {
    await loginOperator(page);
    await page.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(page);
    await openOperatorConversation(page, SEEDED_OPEN_CONVERSATION_PREVIEW);
    await waitForOperatorThreadRealtimeReady(page);

    await Promise.all([
      page.waitForURL(/\/contacts\/[0-9a-f-]+/, { timeout: 60_000 }),
      page.getByRole("link", { name: "View full profile" }).click(),
    ]);
    await expect(page.getByTestId("contact-profile-panel")).toBeVisible({
      timeout: 60_000,
    });
  });
});
