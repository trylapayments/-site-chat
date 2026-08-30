import { expect, test, type Page } from "@playwright/test";

import {
  APP_URL,
  loginOperator,
  openOperatorConversation,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
} from "../../helpers";

const IDLE_MS = 12_000;

function isListConversations(url: string): boolean {
  return url.includes("/rest/v1/rpc/list_conversations");
}

function isConversationRscRefresh(url: string, method: string): boolean {
  return (
    method === "POST" &&
    /\/app\/acme-support\/inbox\/[0-9a-f-]{36}/i.test(url) &&
    !url.includes("/rest/v1/")
  );
}

async function countIdleTraffic(page: Page, idleMs: number) {
  let listConversations = 0;
  let conversationRefresh = 0;
  let unreadTotal = 0;

  const onRequest = (request: { url: () => string; method: () => string }) => {
    const url = request.url();
    const method = request.method();
    if (isListConversations(url)) {
      listConversations += 1;
    }
    if (isConversationRscRefresh(url, method)) {
      conversationRefresh += 1;
    }
    if (url.includes("/rest/v1/rpc/get_inbox_unread_total")) {
      unreadTotal += 1;
    }
  };

  page.on("request", onRequest);
  await page.waitForTimeout(idleMs);
  page.off("request", onRequest);

  return { listConversations, conversationRefresh, unreadTotal };
}

/**
 * Team chrome shares Inbox's GlobalSidebar. Prefetch / searchParams / router
 * identity churn must not resubscribe postgres_changes or router.refresh()
 * the conversation tree while the operator is idle.
 */
test("inbox stays idle-stable after selecting a conversation", async ({ page }) => {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);

  await openOperatorConversation(page, SEEDED_OPEN_CONVERSATION_PREVIEW);
  await waitForOperatorInboxRealtimeReady(page);
  await waitForOperatorThreadRealtimeReady(page);

  const list = page.getByTestId("inbox-conversation-list");
  await expect(list).toBeVisible();

  const selected = list.locator('[data-selected="true"]');
  await expect(selected).toBeVisible();
  const selectedId = await selected.getAttribute("data-conversation-id");
  expect(selectedId).toBeTruthy();

  const realtime = page.getByTestId("inbox-realtime-ready");
  await expect(realtime).toHaveAttribute("data-realtime-state", "connected");

  const traffic = await countIdleTraffic(page, IDLE_MS);

  await expect(realtime).toHaveAttribute("data-realtime-state", "connected");
  await expect(selected).toHaveAttribute("data-conversation-id", selectedId!);
  await expect(page).toHaveURL(new RegExp(`/inbox/${selectedId}`, "i"));
  await expect(list).toBeVisible();
  await expect(list.locator('[role="row"][data-conversation-id]').first()).toBeVisible();

  // One reconnect catch-up is allowed. A 1 Hz idle refetch loop is not.
  expect(
    traffic.listConversations,
    `idle list_conversations=${String(traffic.listConversations)}`,
  ).toBeLessThanOrEqual(2);
  expect(
    traffic.conversationRefresh,
    `idle conversation RSC refresh=${String(traffic.conversationRefresh)}`,
  ).toBeLessThanOrEqual(3);
  expect(
    traffic.unreadTotal,
    `idle get_inbox_unread_total=${String(traffic.unreadTotal)}`,
  ).toBeLessThanOrEqual(2);
});
