import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

import {
  APP_URL,
  loginOperator,
  openOperatorConversation,
  openWidget,
  operatorReplyComposer,
  sendOperatorReply,
  sendWidgetMessage,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetComposer,
  widgetFrameLocator,
} from "../../helpers";

// Playwright loads specs as CommonJS in this repo — avoid import.meta.
const fixturesDir = path.join(process.cwd(), "e2e/fixtures");

async function prepareOperatorInbox(page: Page) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

test.describe("attachments", () => {
  test("widget file picker accepts image and shows pending attachment", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);

    const frame = widgetFrameLocator(visitor);
    const fileInput = frame.getByTestId("widget-file-input");
    await expect(frame.getByTestId("widget-attach-button")).toBeVisible();

    await fileInput.setInputFiles(path.join(fixturesDir, "sample.png"));
    await expect(frame.getByTestId("pending-attachments")).toBeVisible({
      timeout: 15_000,
    });
    await expect(frame.getByText("sample.png")).toBeVisible();

    await visitor.close();
  });

  test("widget file picker accepts PDF document", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);

    const frame = widgetFrameLocator(visitor);
    await frame
      .getByTestId("widget-file-input")
      .setInputFiles(path.join(fixturesDir, "sample.pdf"));
    await expect(frame.getByTestId("pending-attachments")).toBeVisible({
      timeout: 15_000,
    });
    await expect(frame.getByText("sample.pdf")).toBeVisible();

    await visitor.close();
  });

  test("widget supports drag highlight and paste target on composer", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);
    const frame = widgetFrameLocator(visitor);
    const composer = widgetComposer(visitor);

    await composer.focus();
    // Dispatch a paste with a synthetic File via DataTransfer in the iframe.
    await frame.locator("textarea").evaluate((node) => {
      const textarea = node as HTMLTextAreaElement;
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "paste.jpg", {
        type: "image/jpeg",
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      textarea.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await expect(frame.getByTestId("pending-attachments")).toBeVisible({
      timeout: 15_000,
    });
    await visitor.close();
  });

  test("operator attach control is available in live thread", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `attach-ready-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);
    await expect(widgetFrameLocator(visitor).getByText(marker)).toBeVisible({
      timeout: 30_000,
    });

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByTestId("operator-attach-button")).toBeVisible();
    await expect(operator.getByTestId("operator-file-input")).toBeAttached();

    await sendOperatorReply(operator, `ack-${marker}`);
    await expect(widgetFrameLocator(visitor).getByText(`ack-${marker}`)).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("upload status region exposes aria live for screen readers", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);
    const frame = widgetFrameLocator(visitor);
    const status = frame.getByTestId("upload-status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveAttribute("data-upload-status", "idle");
    await visitor.close();
  });

  test("visitor image attachment arrives live for operator", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-img-${Date.now()}`;
    await openWidget(visitor);
    await waitForWidgetRealtimeReady(visitor);
    const frame = widgetFrameLocator(visitor);

    await frame
      .getByTestId("widget-file-input")
      .setInputFiles(path.join(fixturesDir, "sample.png"));
    await expect(frame.getByTestId("pending-attachments")).toBeVisible({
      timeout: 15_000,
    });
    await widgetComposer(visitor).fill(marker);
    await frame.getByRole("button", { name: "Send" }).click();

    await expect(frame.getByText(marker)).toBeVisible({ timeout: 60_000 });
    await expect(frame.getByTestId("attachment-image")).toBeVisible({
      timeout: 60_000,
    });

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByText(marker)).toBeVisible({ timeout: 30_000 });
    await expect(operator.getByTestId("operator-attachment-image")).toBeVisible({
      timeout: 30_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("operator image attachment arrives live for visitor", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `operator-img-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await waitForWidgetRealtimeReady(visitor);

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);

    await operator
      .getByTestId("operator-file-input")
      .setInputFiles(path.join(fixturesDir, "sample.png"));
    await expect(operator.getByTestId("operator-pending-attachments")).toBeVisible();
    const replyMarker = `ack-img-${marker}`;
    await operatorReplyComposer(operator).fill(replyMarker);
    await operator.getByRole("button", { name: "Send reply" }).click();

    await expect(operator.getByText(replyMarker)).toBeVisible({ timeout: 60_000 });
    await expect(operator.getByTestId("operator-attachment-image")).toBeVisible({
      timeout: 60_000,
    });

    const frame = widgetFrameLocator(visitor);
    await expect(frame.getByText(replyMarker)).toBeVisible({ timeout: 60_000 });
    await expect(frame.getByTestId("attachment-image")).toBeVisible({
      timeout: 60_000,
    });

    await visitorContext.close();
    await operatorContext.close();
  });

  test("visitor PDF attachment is downloadable for operator", async ({ browser }) => {
    const visitorContext = await browser.newContext();
    const operatorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const operator = await operatorContext.newPage();

    const marker = `visitor-pdf-${Date.now()}`;
    await openWidget(visitor);
    await waitForWidgetRealtimeReady(visitor);
    const frame = widgetFrameLocator(visitor);

    await frame
      .getByTestId("widget-file-input")
      .setInputFiles(path.join(fixturesDir, "sample.pdf"));
    await widgetComposer(visitor).fill(marker);
    await frame.getByRole("button", { name: "Send" }).click();

    await expect(frame.getByTestId("attachment-document")).toBeVisible({
      timeout: 60_000,
    });
    await expect(frame.getByTestId("attachment-download")).toBeVisible();

    await prepareOperatorInbox(operator);
    await openOperatorConversation(operator, marker);
    await waitForOperatorThreadRealtimeReady(operator);
    await expect(operator.getByTestId("operator-attachment-document")).toBeVisible({
      timeout: 60_000,
    });
    await expect(operator.getByTestId("operator-attachment-download")).toBeVisible();

    await visitorContext.close();
    await operatorContext.close();
  });
});
