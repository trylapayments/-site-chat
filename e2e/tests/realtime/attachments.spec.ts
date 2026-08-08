import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_URL,
  loginOperator,
  openOperatorConversation,
  openWidget,
  sendOperatorReply,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
  waitForWidgetRealtimeReady,
  widgetComposer,
  widgetFrameLocator,
} from "../../helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "../../fixtures");

async function prepareOperatorInbox(page: Page) {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
}

test.describe("attachments", () => {
  test("widget file picker accepts image and shows pending attachment", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);
    await waitForWidgetRealtimeReady(visitor);

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

  test("widget supports drag highlight and paste target on composer", async ({ browser }) => {
    const visitor = await browser.newPage();
    await openWidget(visitor);
    await waitForWidgetRealtimeReady(visitor);
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
    await waitForWidgetRealtimeReady(visitor);
    await widgetComposer(visitor).fill(marker);
    await widgetFrameLocator(visitor).getByRole("button", { name: "Send" }).click();
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
});
