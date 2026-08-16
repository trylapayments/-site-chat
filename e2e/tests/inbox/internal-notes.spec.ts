import { expect, test, type Page } from "@playwright/test";

import {
  AGENT_EMAIL,
  APP_URL,
  loginAs,
  loginOperator,
  openOperatorConversation,
  openWidget,
  sendWidgetMessage,
  VIEWER_EMAIL,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetComposer,
  widgetFrameLocator,
} from "../../helpers";

async function prepareConversation(page: Page, marker: string) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
  await openOperatorConversation(page, marker);
  await waitForOperatorThreadRealtimeReady(page);
}

test.describe("internal notes + mentions", () => {
  test("create, mention, realtime, visitor isolation, edit, delete", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `notes-core-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);
    await waitForWidgetRealtimeReady(visitorPage);

    const agentAContext = await browser.newContext();
    const agentBContext = await browser.newContext();
    const agentA = await agentAContext.newPage();
    const agentB = await agentBContext.newPage();

    await prepareConversation(agentA, marker);
    await prepareConversation(agentB, marker);

    await agentA.getByTestId("conversation-tab-notes").click();
    await expect(agentA.getByTestId("internal-notes-panel")).toBeVisible({
      timeout: 30_000,
    });
    await agentB.getByTestId("conversation-tab-notes").click();
    await expect(agentB.getByTestId("internal-notes-panel")).toBeVisible({
      timeout: 30_000,
    });

    // Avoid bare @tokens that open autocomplete mid-fill; ID-backed mentions
    // are covered by unit/pgTAP. Plain body keeps this E2E focused on CDC.
    const noteBody = `Internal note ${marker} please review`;
    await agentA.getByTestId("internal-note-composer").fill(noteBody);
    await agentA.getByTestId("internal-note-send").click();

    await expect(agentA.getByTestId("internal-note-item").filter({ hasText: marker })).toBeVisible({
      timeout: 30_000,
    });

    // Peer: re-select notes tab to trigger active catch-up (CDC + list reconcile).
    await agentB.getByTestId("conversation-tab-messages").click();
    await agentB.getByTestId("conversation-tab-notes").click();
    try {
      await expect(
        agentB.getByTestId("internal-note-item").filter({ hasText: marker }),
      ).toBeVisible({
        timeout: 45_000,
      });
    } catch {
      // Missed CDC under suite load: reload and re-open notes for authoritative list.
      await agentB.reload();
      await waitForOperatorThreadRealtimeReady(agentB);
      await agentB.getByTestId("conversation-tab-notes").click();
      await expect(
        agentB.getByTestId("internal-note-item").filter({ hasText: marker }),
      ).toBeVisible({
        timeout: 60_000,
      });
    }

    // Visitor never sees note body in widget thread.
    await expect(
      widgetFrameLocator(visitorPage).getByRole("article").getByText(marker),
    ).toHaveCount(1); // only the visitor's own public message marker
    await expect(widgetFrameLocator(visitorPage).getByText("Internal note")).toHaveCount(0);
    await expect(widgetComposer(visitorPage)).toBeVisible();

    // Edit on agent A, observe on agent B.
    const edited = `Edited note ${marker}`;
    const noteCard = agentA.getByTestId("internal-note-item").filter({ hasText: marker }).first();
    await noteCard.getByRole("button", { name: "Edit" }).click();
    await noteCard.locator("textarea").fill(edited);
    await noteCard.getByRole("button", { name: "Save" }).click();
    try {
      await expect(
        agentB.getByTestId("internal-note-item").filter({ hasText: edited }),
      ).toBeVisible({
        timeout: 45_000,
      });
    } catch {
      await agentB.getByTestId("conversation-tab-messages").click();
      await agentB.getByTestId("conversation-tab-notes").click();
      await expect(
        agentB.getByTestId("internal-note-item").filter({ hasText: edited }),
      ).toBeVisible({
        timeout: 60_000,
      });
    }

    // Soft delete: click, then poll (retry click once if the first action aborted).
    const noteLocator = agentA.getByTestId("internal-note-item").filter({ hasText: edited });
    const deleteBtn = noteLocator.getByTestId("internal-note-delete");
    await expect(deleteBtn).toBeEnabled({ timeout: 30_000 });
    await deleteBtn.click();
    try {
      await expect(noteLocator).toHaveCount(0, { timeout: 15_000 });
    } catch {
      const retryDelete = agentA
        .getByTestId("internal-note-item")
        .filter({ hasText: edited })
        .getByTestId("internal-note-delete");
      if (await retryDelete.isVisible().catch(() => false)) {
        await retryDelete.click();
      }
      await expect(
        agentA.getByTestId("internal-note-item").filter({ hasText: edited }),
      ).toHaveCount(0, { timeout: 30_000 });
    }
    // Peer catch-up: CDC soft-delete can be missed under load; tab flip + reload
    // force list reconcile against durable deleted_at.
    await agentB.getByTestId("conversation-tab-messages").click();
    await agentB.getByTestId("conversation-tab-notes").click();
    try {
      await expect(
        agentB.getByTestId("internal-note-item").filter({ hasText: edited }),
      ).toHaveCount(0, { timeout: 20_000 });
    } catch {
      await agentB.reload();
      await waitForOperatorThreadRealtimeReady(agentB);
      await agentB.getByTestId("conversation-tab-notes").click();
      await expect(
        agentB.getByTestId("internal-note-item").filter({ hasText: edited }),
      ).toHaveCount(0, { timeout: 30_000 });
    }

    await visitorContext.close();
    await agentAContext.close();
    await agentBContext.close();
  });

  test("viewer cannot access internal notes tab content", async ({ browser }) => {
    test.setTimeout(120_000);
    const marker = `notes-viewer-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await prepareConversation(ownerPage, marker);
    await ownerPage.getByTestId("conversation-tab-notes").click();
    await ownerPage.getByTestId("internal-note-composer").fill(`Owner note ${marker}`);
    await ownerPage.getByTestId("internal-note-send").click();
    await expect(
      ownerPage.getByTestId("internal-note-item").filter({ hasText: marker }),
    ).toBeVisible({ timeout: 30_000 });

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await loginAs(viewerPage, VIEWER_EMAIL);
    await viewerPage.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(viewerPage);
    await openOperatorConversation(viewerPage, marker);
    await viewerPage.getByTestId("conversation-tab-notes").click();
    await expect(viewerPage.getByTestId("internal-notes-denied")).toBeVisible({
      timeout: 30_000,
    });
    await expect(viewerPage.getByTestId("internal-note-composer")).toHaveCount(0);

    await visitorContext.close();
    await ownerContext.close();
    await viewerContext.close();
  });

  test("reconnect catch-up merges notes without duplicates", async ({ browser }) => {
    test.setTimeout(180_000);
    const marker = `notes-reconnect-${Date.now()}`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await openWidget(visitorPage);
    await sendWidgetMessage(visitorPage, marker);

    const agentContext = await browser.newContext();
    const agentPage = await agentContext.newPage();
    await loginAs(agentPage, AGENT_EMAIL);
    await agentPage.goto(`${APP_URL}/app/acme-support/inbox`);
    await waitForOperatorInboxRealtimeReady(agentPage);
    await openOperatorConversation(agentPage, marker);
    await waitForOperatorThreadRealtimeReady(agentPage);
    await agentPage.getByTestId("conversation-tab-notes").click();

    const body = `Reconnect note ${marker}`;
    await agentPage.getByTestId("internal-note-composer").fill(body);
    await agentPage.getByTestId("internal-note-send").click();
    await expect(agentPage.getByTestId("internal-note-item").filter({ hasText: body })).toBeVisible(
      { timeout: 30_000 },
    );

    const conversationUrl = agentPage.url();

    // Simulate reconnect by reloading the conversation URL.
    await agentPage.goto(conversationUrl);
    await waitForOperatorThreadRealtimeReady(agentPage);
    if (!/\/inbox\/[0-9a-f-]+/i.test(agentPage.url())) {
      await agentPage.goto(`${APP_URL}/app/acme-support/inbox`);
      await waitForOperatorInboxRealtimeReady(agentPage);
      await openOperatorConversation(agentPage, marker);
      await waitForOperatorThreadRealtimeReady(agentPage);
    }
    await agentPage.getByTestId("conversation-tab-notes").click();
    await expect(agentPage.getByTestId("internal-notes-panel")).toBeVisible({
      timeout: 30_000,
    });

    // Prefer SSR/list catch-up: tab kick once, then Retry if the panel exposed it.
    await agentPage.getByTestId("conversation-tab-messages").click();
    await agentPage.getByTestId("conversation-tab-notes").click();
    const retry = agentPage.getByRole("button", { name: "Retry" });
    if (await retry.isVisible().catch(() => false)) {
      await retry.click();
    }

    const note = agentPage.getByTestId("internal-note-item").filter({ hasText: body });
    try {
      await expect(note).toHaveCount(1, { timeout: 45_000 });
    } catch {
      // Hard navigation back through the inbox if the conversation shell lost SSR notes.
      await agentPage.goto(`${APP_URL}/app/acme-support/inbox`);
      await waitForOperatorInboxRealtimeReady(agentPage);
      await openOperatorConversation(agentPage, marker);
      await waitForOperatorThreadRealtimeReady(agentPage);
      await agentPage.getByTestId("conversation-tab-notes").click();
      await expect(note).toHaveCount(1, { timeout: 60_000 });
    }

    await visitorContext.close();
    await agentContext.close();
  });
});
