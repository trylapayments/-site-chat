import { expect, test, type Page } from "@playwright/test";

import {
  ADMIN_EMAIL,
  AGENT_EMAIL,
  APP_URL,
  loginAs,
  loginOperator,
  openOperatorConversation,
  openWidget,
  sendWidgetMessage,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
} from "../../helpers";

async function prepareInbox(page: Page, email: string) {
  await loginAs(page, email);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

async function openAssignmentConversation(page: Page, marker: string) {
  await openOperatorConversation(page, marker);
  await waitForOperatorThreadRealtimeReady(page);
  await expect(page.getByTestId("assignment-panel")).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Wait until the Take/Assign/Unassign server action finishes.
 * Optimistic UI can clear "Unassigned" before the RPC commits; navigating away
 * aborts the in-flight Next.js server action and leaves the DB unchanged.
 */
async function waitForAssignmentMutation(page: Page, successPattern: RegExp) {
  await expect(page.getByTestId("assignment-live")).toHaveText(successPattern, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("assignment-panel")).toHaveAttribute("data-pending", "false", {
    timeout: 30_000,
  });
}

async function startVisitorConversation(
  browser: import("@playwright/test").Browser,
  marker: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openWidget(page);
  await sendWidgetMessage(page, marker);
  await waitForWidgetRealtimeReady(page);
  return { context, page };
}

test.describe("conversation assignment & queues", () => {
  test("take, live inbox sync, transfer, unassign, and timeline", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `assign-core-${Date.now()}`;
    const { context: visitorContext } = await startVisitorConversation(browser, marker);

    const operatorAContext = await browser.newContext();
    const operatorBContext = await browser.newContext();
    const operatorA = await operatorAContext.newPage();
    const operatorB = await operatorBContext.newPage();

    await prepareInbox(operatorA, AGENT_EMAIL);
    await operatorA.getByTestId("inbox-assignment-tab-unassigned").click();
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 60_000,
    });

    await openAssignmentConversation(operatorA, marker);
    await expect(operatorA.getByTestId("assignment-current")).toHaveText(/Unassigned/i);
    await operatorA.getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operatorA, /assigned to you/i);

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await prepareInbox(operatorB, ADMIN_EMAIL);
    await operatorB.getByTestId("inbox-assignment-tab-all").click();
    await waitForOperatorInboxRealtimeReady(operatorB);
    const bRow = operatorB.getByRole("row").filter({ hasText: marker });
    await expect(bRow).toBeVisible({ timeout: 60_000 });
    await expect(bRow.getByTestId("inbox-row-assignee")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });

    await openAssignmentConversation(operatorB, marker);
    await expect(operatorB.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i);
    await expect(operatorB.getByTestId("assignment-take")).toHaveCount(0);

    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=all`);
    await waitForOperatorInboxRealtimeReady(operatorB);
    await expect(operatorB.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await openAssignmentConversation(operatorA, marker);
    await operatorA.getByTestId("assignment-open-picker").click();
    await expect(operatorA.getByTestId("assignment-picker")).toBeVisible();
    const adminOption = operatorA
      .locator('[data-testid^="assignment-member-"]')
      .filter({ hasText: ADMIN_EMAIL });
    await expect(adminOption).toBeVisible({ timeout: 15_000 });
    await adminOption.click();
    await waitForAssignmentMutation(operatorA, /transferred/i);

    const bRowAfterTransfer = operatorB.getByRole("row").filter({ hasText: marker });
    await expect(bRowAfterTransfer.getByTestId("inbox-row-assignee")).toContainText(ADMIN_EMAIL, {
      timeout: 60_000,
    });

    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operatorB);
    await expect(operatorB.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await openAssignmentConversation(operatorB, marker);
    await operatorB.getByTestId("assignment-unassign").click();
    await waitForAssignmentMutation(operatorB, /unassigned/i);

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await openAssignmentConversation(operatorA, marker);
    const timeline = operatorA.getByTestId("customer-timeline");
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(timeline.locator('[data-event-type="conversation_assigned"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.locator('[data-event-type="conversation_transferred"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(timeline.locator('[data-event-type="conversation_unassigned"]')).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorAContext.close();
    await operatorBContext.close();
  });

  test("concurrent Take: exactly one winner", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `assign-race-${Date.now()}`;
    const { context: visitorContext } = await startVisitorConversation(browser, marker);

    const operatorAContext = await browser.newContext();
    const operatorBContext = await browser.newContext();
    const operatorA = await operatorAContext.newPage();
    const operatorB = await operatorBContext.newPage();

    await prepareInbox(operatorA, AGENT_EMAIL);
    await prepareInbox(operatorB, ADMIN_EMAIL);
    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorB);

    await openAssignmentConversation(operatorA, marker);
    await openAssignmentConversation(operatorB, marker);

    await Promise.all([
      operatorA.getByTestId("assignment-take").click(),
      operatorB.getByTestId("assignment-take").click(),
    ]);

    await expect(operatorA.getByTestId("assignment-panel")).toHaveAttribute(
      "data-pending",
      "false",
      { timeout: 30_000 },
    );
    await expect(operatorB.getByTestId("assignment-panel")).toHaveAttribute(
      "data-pending",
      "false",
      { timeout: 30_000 },
    );

    await operatorA.reload();
    await operatorB.reload();
    await waitForOperatorThreadRealtimeReady(operatorA);
    await waitForOperatorThreadRealtimeReady(operatorB);

    await expect(operatorA.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });
    await expect(operatorB.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          const aId =
            (await operatorA.getByTestId("assignment-panel").getAttribute("data-assignee-id")) ??
            "";
          const bId =
            (await operatorB.getByTestId("assignment-panel").getAttribute("data-assignee-id")) ??
            "";
          return aId.length > 0 && aId === bId;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    await visitorContext.close();
    await operatorAContext.close();
    await operatorBContext.close();
  });

  test("multi-tab Mine sync after Take", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `assign-multitab-${Date.now()}`;
    const { context: visitorContext } = await startVisitorConversation(browser, marker);

    const operatorContext = await browser.newContext();
    const tab1 = await operatorContext.newPage();
    const tab2 = await operatorContext.newPage();

    await prepareInbox(tab1, AGENT_EMAIL);
    await tab1.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(tab1);
    await tab2.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(tab2);

    await expect(tab1.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 60_000,
    });
    await openAssignmentConversation(tab1, marker);
    await tab1.getByTestId("assignment-take").click();
    await waitForAssignmentMutation(tab1, /assigned to you/i);

    await tab2.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(tab2);
    await expect(tab2.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("reconnect catch-up shows peer Take", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `assign-reconnect-${Date.now()}`;
    const { context: visitorContext } = await startVisitorConversation(browser, marker);

    const operatorAContext = await browser.newContext();
    const operatorBContext = await browser.newContext();
    const operatorA = await operatorAContext.newPage();
    const operatorB = await operatorBContext.newPage();

    await prepareInbox(operatorA, AGENT_EMAIL);
    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await openAssignmentConversation(operatorA, marker);

    await operatorA.context().setOffline(true);
    await prepareInbox(operatorB, ADMIN_EMAIL);
    await openAssignmentConversation(operatorB, marker);
    await operatorB.getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operatorB, /assigned to you/i);

    await operatorA.context().setOffline(false);
    await operatorA.reload();
    await waitForOperatorThreadRealtimeReady(operatorA);
    await expect(operatorA.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 60_000,
    });

    await visitorContext.close();
    await operatorAContext.close();
    await operatorBContext.close();
  });

  test("assignment does not reorder by assignment time", async ({ browser }) => {
    test.setTimeout(180_000);
    const orderMarkerOld = `assign-order-old-${Date.now()}`;
    const orderMarkerNew = `assign-order-new-${Date.now()}`;

    const operatorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    await prepareInbox(operator, AGENT_EMAIL);

    const { context: visitorOldContext } = await startVisitorConversation(browser, orderMarkerOld);
    await operator.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operator);
    await openAssignmentConversation(operator, orderMarkerOld);
    await operator.getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operator, /assigned to you/i);

    const { context: visitorNewContext } = await startVisitorConversation(browser, orderMarkerNew);
    await operator.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operator);
    await openAssignmentConversation(operator, orderMarkerNew);
    await operator.getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operator, /assigned to you/i);

    await operator.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operator);
    const texts = await operator.getByRole("row").allTextContents();
    const idxNew = texts.findIndex((t) => t.includes(orderMarkerNew));
    const idxOld = texts.findIndex((t) => t.includes(orderMarkerOld));
    expect(idxNew).toBeGreaterThanOrEqual(0);
    expect(idxOld).toBeGreaterThanOrEqual(0);
    expect(idxNew).toBeLessThan(idxOld);

    await visitorOldContext.close();
    await visitorNewContext.close();
    await operatorContext.close();
  });

  test("owner login still reaches inbox (messaging flows remain green)", async ({ page }) => {
    await loginOperator(page);
    await page.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(page);
    await expect(page.getByTestId("inbox-assignment-tabs")).toBeVisible();
  });
});
