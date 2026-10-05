import { expect, test } from "@playwright/test";
import {
  APP_URL,
  conversationThread,
  loginOperator,
  openWidget,
  operatorReplyComposer,
  sendOperatorReply,
  sendWidgetMessage,
  widgetFrameLocator,
} from "../../helpers";

for (const width of [360, 390]) {
  test(`mobile Inbox opens, replies and returns to the queue at ${width}px`, async ({
    browser,
  }) => {
    const operatorContext = await browser.newContext({ viewport: { width, height: 780 } });
    const visitorContext = await browser.newContext();
    const operator = await operatorContext.newPage();
    const visitor = await visitorContext.newPage();
    try {
      await loginOperator(operator);
      await operator.goto(`${APP_URL}/app/acme-support/inbox`);
      await openWidget(visitor);
      const message = `Mobile ${width} visitor ${Date.now()}`;
      await sendWidgetMessage(visitor, message);
      const row = operator
        .getByTestId("inbox-conversation-list")
        .getByRole("row")
        .filter({ hasText: message });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole("link").click();
      await expect(conversationThread(operator)).toBeVisible({ timeout: 30_000 });
      await expect(operator.getByTestId("inbox-queue-pane")).toBeHidden();
      await expect(operator.getByRole("link", { name: "Back to conversations" })).toBeVisible();
      // Reduced visible height represents the space left above a phone keyboard.
      await operator.setViewportSize({ width, height: 450 });
      await operatorReplyComposer(operator).focus();
      const reply = `Mobile ${width} operator reply ${Date.now()}`;
      await operatorReplyComposer(operator).fill(reply);
      const send = operator.getByRole("button", { name: "Send reply", exact: true });
      await expect(send).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() =>
          operator.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        )
        .toBe(true);
      await sendOperatorReply(operator, reply);
      await expect(
        widgetFrameLocator(visitor).getByRole("article").getByText(reply, { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await operator.getByRole("link", { name: "Back to conversations" }).click();
      await expect(operator.getByTestId("inbox-queue-pane")).toBeVisible();
      await expect(conversationThread(operator)).toHaveCount(0);
      await expect
        .poll(() =>
          operator.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        )
        .toBe(true);
    } finally {
      await operatorContext.close();
      await visitorContext.close();
    }
  });
}
