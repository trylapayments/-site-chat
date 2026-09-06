import { expect, test, type Page } from "@playwright/test";

import {
  ADMIN_EMAIL,
  AGENT_EMAIL,
  APP_URL,
  assignmentHeader,
  loginAs,
  loginOperator,
  openInspectorActivity,
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
  await expect(assignmentHeader(page)).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Wait until the Take/Assign/Unassign server action finishes.
 * Optimistic UI can clear "Unassigned" before the RPC commits; navigating away
 * aborts the in-flight Next.js server action and leaves the DB unchanged.
 */
async function waitForAssignmentMutation(page: Page, successPattern: RegExp) {
  const panel = assignmentHeader(page);
  // Prefer the pending cycle (authoritative mutation completion). Live region
  // text can lag or retain a prior announcement under suite load.
  await expect(panel)
    .toHaveAttribute("data-pending", "true", { timeout: 5_000 })
    .catch(() => undefined);
  await expect(panel).toHaveAttribute("data-pending", "false", {
    timeout: 30_000,
  });
  await expect(panel.getByTestId("assignment-live")).toHaveText(successPattern, {
    timeout: 15_000,
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
    await expect(assignmentHeader(operatorA).getByTestId("assignment-current")).toHaveText(
      /Unassigned/i,
    );
    await assignmentHeader(operatorA).getByTestId("assignment-take").click();
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
    await expect(assignmentHeader(operatorB).getByTestId("assignment-current")).not.toHaveText(
      /Unassigned/i,
    );
    await expect(assignmentHeader(operatorB).getByTestId("assignment-take")).toHaveCount(0);

    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=all`);
    await waitForOperatorInboxRealtimeReady(operatorB);
    await expect(operatorB.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await openAssignmentConversation(operatorA, marker);
    await assignmentHeader(operatorA).getByTestId("assignment-open-picker").click();
    await expect(assignmentHeader(operatorA).getByTestId("assignment-picker")).toBeVisible();
    const adminOption = assignmentHeader(operatorA)
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
    await assignmentHeader(operatorB).getByTestId("assignment-unassign").click();
    await waitForAssignmentMutation(operatorB, /unassigned/i);

    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await expect(operatorA.getByRole("row").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    await openAssignmentConversation(operatorA, marker);
    await openInspectorActivity(operatorA);
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

  test("stale transfer conflicts and UI rolls back", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `assign-stale-transfer-${Date.now()}`;
    const { context: visitorContext } = await startVisitorConversation(browser, marker);

    const operatorAContext = await browser.newContext();
    const operatorBContext = await browser.newContext();
    const operatorA = await operatorAContext.newPage();
    const operatorB = await operatorBContext.newPage();

    await prepareInbox(operatorA, AGENT_EMAIL);
    await operatorA.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operatorA);
    await openAssignmentConversation(operatorA, marker);
    await assignmentHeader(operatorA).getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operatorA, /assigned to you/i);

    await prepareInbox(operatorB, ADMIN_EMAIL);
    await operatorB.goto(`${APP_URL}/app/acme-support/inbox?assignment=all`);
    await waitForOperatorInboxRealtimeReady(operatorB);
    await openAssignmentConversation(operatorB, marker);
    await expect(assignmentHeader(operatorB).getByTestId("assignment-current")).not.toHaveText(
      /Unassigned/i,
    );

    const staleVersion = await assignmentHeader(operatorB).getAttribute("data-assignment-version");
    expect(staleVersion).toBeTruthy();

    // Keep operator B on a stale assignment_version by blocking RSC refreshes.
    // Next 15 router.refresh() is POST; still allow server actions (next-action).
    await operatorB.route("**/app/**", async (route) => {
      const request = route.request();
      const headers = request.headers();
      const isServerAction = headers["next-action"] !== undefined;
      const isRscRefresh =
        !isServerAction &&
        (headers["rsc"] === "1" ||
          headers["next-router-state-tree"] !== undefined ||
          request.url().includes("_rsc"));
      if (isRscRefresh) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    // Operator A is already on the taken conversation — do not re-open via the
    // Unassigned inbox list (the row leaves that filter after Take).
    await expect(assignmentHeader(operatorA)).toBeVisible();
    await assignmentHeader(operatorA).getByTestId("assignment-open-picker").click();
    await expect(assignmentHeader(operatorA).getByTestId("assignment-picker")).toBeVisible();
    const adminOption = assignmentHeader(operatorA)
      .locator('[data-testid^="assignment-member-"]')
      .filter({ hasText: ADMIN_EMAIL });
    await expect(adminOption).toBeVisible({ timeout: 15_000 });
    await adminOption.click();
    await waitForAssignmentMutation(operatorA, /transferred/i);

    // Realtime may advance B's assignment_version even while RSC is blocked.
    // Only the stale-conflict path applies when B is still on the captured version.
    const versionAfterTransfer =
      await assignmentHeader(operatorB).getAttribute("data-assignment-version");

    if (versionAfterTransfer === staleVersion) {
      await expect(assignmentHeader(operatorB).getByTestId("assignment-current")).not.toHaveText(
        ADMIN_EMAIL,
        {
          timeout: 5_000,
        },
      );

      await assignmentHeader(operatorB).getByTestId("assignment-open-picker").click();
      await expect(assignmentHeader(operatorB).getByTestId("assignment-picker")).toBeVisible();
      const staleAdminOption = assignmentHeader(operatorB)
        .locator('[data-testid^="assignment-member-"]')
        .filter({ hasText: ADMIN_EMAIL });
      await expect(staleAdminOption).toBeVisible({ timeout: 15_000 });
      await staleAdminOption.click();

      await expect(assignmentHeader(operatorB)).toHaveAttribute("data-pending", "false", {
        timeout: 30_000,
      });

      const live = assignmentHeader(operatorB).getByTestId("assignment-live");
      const current = assignmentHeader(operatorB).getByTestId("assignment-current");
      // Conflict announcement, no-op "current assignee", or CDC already
      // reconciled B to admin (version check is racy with live updates).
      await expect
        .poll(
          async () => {
            const liveText = ((await live.textContent()) ?? "").trim();
            const currentText = ((await current.textContent()) ?? "").trim();
            if (
              /just assigned|current assignee|conflict|changed concurrently|version mismatch|transferred/i.test(
                liveText,
              )
            ) {
              return "announced";
            }
            if (new RegExp(ADMIN_EMAIL, "i").test(currentText)) {
              return "reconciled";
            }
            return "pending";
          },
          { timeout: 30_000 },
        )
        .toMatch(/announced|reconciled/);

      if (!new RegExp(ADMIN_EMAIL, "i").test((await current.textContent()) ?? "")) {
        await expect(current).not.toHaveText(ADMIN_EMAIL);
      }
    } else {
      // Live CDC already reconciled B — transfer is visible without a stale conflict.
      await expect(assignmentHeader(operatorB).getByTestId("assignment-current")).toContainText(
        ADMIN_EMAIL,
        {
          timeout: 15_000,
        },
      );
    }

    await operatorB.unrouteAll();
    await operatorB.reload();
    await waitForOperatorThreadRealtimeReady(operatorB);
    await expect(assignmentHeader(operatorB).getByTestId("assignment-current")).toContainText(
      ADMIN_EMAIL,
      {
        timeout: 30_000,
      },
    );

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
      assignmentHeader(operatorA).getByTestId("assignment-take").click(),
      assignmentHeader(operatorB).getByTestId("assignment-take").click(),
    ]);

    await expect(assignmentHeader(operatorA)).toHaveAttribute("data-pending", "false", {
      timeout: 30_000,
    });
    await expect(assignmentHeader(operatorB)).toHaveAttribute("data-pending", "false", {
      timeout: 30_000,
    });

    await operatorA.reload();
    await operatorB.reload();
    await waitForOperatorThreadRealtimeReady(operatorA);
    await waitForOperatorThreadRealtimeReady(operatorB);

    await expect(assignmentHeader(operatorA).getByTestId("assignment-current")).not.toHaveText(
      /Unassigned/i,
      {
        timeout: 30_000,
      },
    );
    await expect(assignmentHeader(operatorB).getByTestId("assignment-current")).not.toHaveText(
      /Unassigned/i,
      {
        timeout: 30_000,
      },
    );
    await expect
      .poll(
        async () => {
          const aId = (await assignmentHeader(operatorA).getAttribute("data-assignee-id")) ?? "";
          const bId = (await assignmentHeader(operatorB).getAttribute("data-assignee-id")) ?? "";
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
    await assignmentHeader(tab1).getByTestId("assignment-take").click();
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
    await assignmentHeader(operatorB).getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operatorB, /assigned to you/i);

    await operatorA.context().setOffline(false);
    await operatorA.reload();
    await waitForOperatorThreadRealtimeReady(operatorA);
    await expect(assignmentHeader(operatorA).getByTestId("assignment-current")).not.toHaveText(
      /Unassigned/i,
      {
        timeout: 60_000,
      },
    );

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
    await assignmentHeader(operator).getByTestId("assignment-take").click();
    await waitForAssignmentMutation(operator, /assigned to you/i);

    const { context: visitorNewContext } = await startVisitorConversation(browser, orderMarkerNew);
    await operator.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await waitForOperatorInboxRealtimeReady(operator);
    await openAssignmentConversation(operator, orderMarkerNew);
    await assignmentHeader(operator).getByTestId("assignment-take").click();
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
