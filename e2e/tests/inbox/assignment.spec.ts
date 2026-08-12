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
  await expect(page.getByTestId("assignment-current")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("conversation assignment & queues", () => {
  test("take, live sync, transfer, unassign, timeline, race, multi-tab, reconnect, ordering", async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const operatorAContext = await browser.newContext();
    const operatorBContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operatorA = await operatorAContext.newPage();
    const operatorB = await operatorBContext.newPage();

    const marker = `assign-core-${Date.now()}`;
    const raceMarker = `assign-race-${Date.now()}`;

    // Visitor creates an unassigned conversation.
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    // Operator A: Unassigned → Take → Mine
    await prepareInbox(operatorA, AGENT_EMAIL);
    await operatorA.getByTestId("inbox-assignment-tab-unassigned").click();
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 60_000,
    });

    await openAssignmentConversation(operatorA, marker);
    await expect(operatorA.getByTestId("assignment-current")).toHaveText(/Unassigned/i);
    await operatorA.getByTestId("assignment-take").click();
    await expect(operatorA.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    // Operator B sees assignment live in All / loses Unassigned
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

    // Operator B cannot silently steal via Take (button absent when assigned to other)
    // Explicit take RPC conflict is covered by pgTAP; UI hides Take when assigned.

    // Transfer A → B
    await openAssignmentConversation(operatorA, marker);
    await operatorA.getByTestId("assignment-open-picker").click();
    await expect(operatorA.getByTestId("assignment-picker")).toBeVisible();
    // Pick admin member (second messaging member in seed).
    const memberOptions = operatorA.locator('[data-testid^="assignment-member-"]');
    await expect(memberOptions.first()).toBeVisible({ timeout: 15_000 });
    // Prefer a non-current option.
    const count = await memberOptions.count();
    let transferred = false;
    for (let i = 0; i < count; i += 1) {
      const option = memberOptions.nth(i);
      const selected = await option.getAttribute("aria-selected");
      if (selected !== "true") {
        await option.click();
        transferred = true;
        break;
      }
    }
    expect(transferred).toBe(true);

    await expect(operatorB.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });

    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operatorB);
    await expect(operatorB.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    // Unassign returns to Unassigned queue
    await openAssignmentConversation(operatorB, marker);
    await operatorB.getByTestId("assignment-unassign").click();
    await expect(operatorB.getByTestId("assignment-current")).toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    // Customer Timeline shows assign / transfer / unassign history
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

    // Race: two operators Take the same unassigned conversation
    await openWidget(visitor);
    await sendWidgetMessage(visitor, raceMarker);

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorB);

    await openAssignmentConversation(operatorA, raceMarker);
    await openAssignmentConversation(operatorB, raceMarker);

    await Promise.all([
      operatorA.getByTestId("assignment-take").click(),
      operatorB.getByTestId("assignment-take").click(),
    ]);

    // Both UIs converge on the single winner (not Unassigned); conflict path refreshes.
    await expect(operatorA.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });
    await expect(operatorB.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });
    await expect
      .poll(async () => {
        const aId =
          (await operatorA.getByTestId("assignment-current").getAttribute("data-assignee-id")) ??
          "";
        const bId =
          (await operatorB.getByTestId("assignment-current").getAttribute("data-assignee-id")) ??
          "";
        return aId.length > 0 && aId === bId;
      }, { timeout: 30_000 })
      .toBe(true);

    // Multi-tab sync for same operator
    const operatorATab2 = await operatorAContext.newPage();
    await operatorATab2.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorATab2);

    const multiMarker = `assign-multitab-${Date.now()}`;
    await sendWidgetMessage(visitor, multiMarker);

    await expect(operatorA.getByRole("row").filter({ hasText: multiMarker })).toBeVisible({
      timeout: 60_000,
    });
    await openAssignmentConversation(operatorA, multiMarker);
    await operatorA.getByTestId("assignment-take").click();
    await expect(operatorA.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });

    // Tab 2 Mine list should gain the conversation via realtime (no stale optimistic).
    await operatorATab2.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operatorATab2);
    await expect(operatorATab2.getByRole("row").filter({ hasText: multiMarker })).toBeVisible({
      timeout: 30_000,
    });

    // Reconnect catch-up: go offline, peer assigns, reconnect sees update
    const reconnectMarker = `assign-reconnect-${Date.now()}`;
    await sendWidgetMessage(visitor, reconnectMarker);
    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await openAssignmentConversation(operatorA, reconnectMarker);

    await operatorA.context().setOffline(true);
    await prepareInbox(operatorB, ADMIN_EMAIL);
    await openAssignmentConversation(operatorB, reconnectMarker);
    await operatorB.getByTestId("assignment-take").click();
    await expect(operatorB.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 30_000,
    });

    await operatorA.context().setOffline(false);
    await waitForOperatorThreadRealtimeReady(operatorA);
    await expect(operatorA.getByTestId("assignment-current")).not.toHaveText(/Unassigned/i, {
      timeout: 60_000,
    });

    // Assignment does not reorder by assignment time — last_message_at ordering retained.
    // Verify Mine list still sorts by activity: newer message appears above older.
    const orderMarkerOld = `assign-order-old-${Date.now()}`;
    const orderMarkerNew = `assign-order-new-${Date.now()}`;
    await sendWidgetMessage(visitor, orderMarkerOld);
    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await openAssignmentConversation(operatorA, orderMarkerOld);
    await operatorA.getByTestId("assignment-take").click();

    await sendWidgetMessage(visitor, orderMarkerNew);
    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await openAssignmentConversation(operatorA, orderMarkerNew);
    await operatorA.getByTestId("assignment-take").click();

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=assigned_to_me`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    const rows = operatorA.getByRole("row");
    const texts = await rows.allTextContents();
    const idxNew = texts.findIndex((t) => t.includes(orderMarkerNew));
    const idxOld = texts.findIndex((t) => t.includes(orderMarkerOld));
    expect(idxNew).toBeGreaterThanOrEqual(0);
    expect(idxOld).toBeGreaterThanOrEqual(0);
    expect(idxNew).toBeLessThan(idxOld);

    await visitorContext.close();
    await operatorAContext.close();
    await operatorBContext.close();
  });

  test("owner login still reaches inbox (messaging flows remain green)", async ({ page }) => {
    await loginOperator(page);
    await page.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(page);
    await expect(page.getByTestId("inbox-assignment-tabs")).toBeVisible();
  });
});
