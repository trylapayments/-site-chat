import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import {
  APP_URL,
  loginOperator,
  openOperatorConversation,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
} from "../../helpers";

const HYDRATION_ERROR =
  /Hydration failed|Text content does not match|Recoverable Error|Minified React error #(418|423|425)/i;

function attachHydrationGuards(page: Page) {
  const errors: string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error" && HYDRATION_ERROR.test(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    if (HYDRATION_ERROR.test(error.message)) {
      errors.push(`pageerror:${error.message}`);
    }
  });

  return errors;
}

/**
 * Safari showed SSR "Aug 30, 2026 at 2:11 PM" vs client "Aug 30, 2026, 2:11 PM"
 * from ConversationSidebar MetaRow dateStyle+timeStyle glue. Guard the
 * hydrated inbox against that class of recoverable React errors.
 */
test("inbox conversation hydrates without date-formatting mismatches", async ({ page }) => {
  const hydrationErrors = attachHydrationGuards(page);

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

  const lastSeen = page.getByTestId("inspector-last-seen");
  if ((await lastSeen.count()) > 0) {
    const text = (await lastSeen.textContent())?.trim() ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\bat\b/);
  }

  // Allow hydration + first paint to finish before asserting console silence.
  await page.waitForTimeout(2_000);

  await expect(selected).toHaveAttribute("data-conversation-id", selectedId!);
  await expect(page).toHaveURL(new RegExp(`/inbox/${selectedId}`, "i"));
  expect(hydrationErrors, `hydration errors:\n${hydrationErrors.join("\n")}`).toEqual([]);
});
