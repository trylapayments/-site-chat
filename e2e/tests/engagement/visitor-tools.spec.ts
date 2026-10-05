import { chromium, expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  APP_URL,
  WORKSPACE_SLUG,
  loginOperator,
  openWidget,
  widgetFrameLocator,
  openOperatorConversation,
  operatorReplyComposer,
} from "../../helpers";

const setupUrl = `${APP_URL}/app/${WORKSPACE_SLUG}/settings/chat-setup`;
const question = "Show quick questions";
const emoji = "Enable emoji picker";
const voice = "Enable voice messages";
async function save(page: Page) {
  const button = page.getByRole("button", { name: "Save settings", exact: true });
  if (!(await button.isEnabled())) return;
  await button.click();
  await expect(page.getByRole("status")).toHaveText("Settings saved.");
}
async function prepare(page: Page) {
  await loginOperator(page);
  await page.goto(setupUrl);
  const previous = {
    questions: await page.getByLabel("Quick questions (one per line)").inputValue(),
    question: await page.getByLabel(question, { exact: true }).isChecked(),
    emoji: await page.getByLabel(emoji, { exact: true }).isChecked(),
    voice: await page.getByLabel(voice, { exact: true }).isChecked(),
    form: await page
      .getByRole("checkbox", { name: "Ask visitors to fill in a form before chatting" })
      .isChecked(),
  };
  await page.getByLabel(question, { exact: true }).check();
  await page.getByLabel(emoji, { exact: true }).check();
  await page.getByLabel(voice, { exact: true }).check();
  await page
    .getByRole("checkbox", { name: "Ask visitors to fill in a form before chatting" })
    .uncheck();
  return async () => {
    await page.goto(setupUrl);
    await page.getByLabel("Quick questions (one per line)").fill(previous.questions);
    await page.getByLabel(question, { exact: true }).setChecked(previous.question);
    await page.getByLabel(emoji, { exact: true }).setChecked(previous.emoji);
    await page.getByLabel(voice, { exact: true }).setChecked(previous.voice);
    await page
      .getByRole("checkbox", { name: "Ask visitors to fill in a form before chatting" })
      .setChecked(previous.form);
    await save(page);
  };
}

test("quick questions send the first message; emoji and visitor tools can be disabled", async ({
  browser,
}) => {
  const operatorContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  const visitor = await visitorContext.newPage();
  const restore = await prepare(operator);
  const text = `Can you help me get started? ${String(Date.now())}`;
  try {
    await operator
      .getByLabel("Quick questions (one per line)")
      .fill(
        `${text}\nWhat services do you offer?\nCan I talk to your team?\nHow does pricing work?`,
      );
    await save(operator);
    await openWidget(visitor);
    const frame = widgetFrameLocator(visitor);
    await expect(
      frame.getByRole("button", { name: "Record voice message", exact: true }),
    ).toBeVisible();
    await visitor.locator('iframe[title="Mill"]').screenshot({
      path: test.info().outputPath("visitor-tools-desktop.png"),
    });
    await visitor.setViewportSize({ width: 390, height: 844 });
    await visitor
      .locator('iframe[title="Mill"]')
      .screenshot({ path: test.info().outputPath("visitor-tools-mobile.png") });
    await visitor.setViewportSize({ width: 1280, height: 720 });
    await frame.getByRole("button", { name: text, exact: true }).click();
    await expect(frame.getByText(text, { exact: true })).toBeVisible();
    await expect(frame.getByRole("button", { name: text, exact: true })).toHaveCount(0);
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await openOperatorConversation(operator, text);
    await expect(operator.getByText(text, { exact: true }).last()).toBeVisible();
    await frame.getByRole("button", { name: "Choose emoji", exact: true }).click();
    await frame.getByRole("button", { name: "Insert 👍", exact: true }).click();
    await expect(frame.getByRole("textbox")).toHaveValue("👍");
    await frame.getByRole("button", { name: "Send", exact: true }).click();
    await expect(operator.getByText("👍", { exact: true }).last()).toBeVisible();
    await operator.goto(setupUrl);
    await operator.getByLabel(question, { exact: true }).uncheck();
    await operator.getByLabel(emoji, { exact: true }).uncheck();
    await operator.getByLabel(voice, { exact: true }).uncheck();
    await save(operator);
    const bootstrapPromise = visitor.waitForResponse(
      (r) => r.url().includes("/api/v1/widget/bootstrap") && r.request().method() === "GET",
    );
    const sessionPromise = visitor.waitForResponse(
      (r) => r.url().includes("/api/v1/widget/session") && r.request().method() === "POST",
    );
    await openWidget(visitor);
    const bootstrap = await (await bootstrapPromise).json();
    const session = await (await sessionPromise).json();
    await expect(frame.getByRole("button", { name: "Choose emoji", exact: true })).toHaveCount(0);
    await expect(
      frame.getByRole("button", { name: "Record voice message", exact: true }),
    ).toHaveCount(0);
    const denied = await visitorContext.request.post(
      `${APP_URL}/api/v1/widget/attachments/uploads`,
      {
        headers: {
          Authorization: `Bearer ${session.data.sessionToken}`,
          "X-SiteChat-Embed-Token": bootstrap.data.embedToken,
          Origin: APP_URL,
        },
        data: {
          embedToken: bootstrap.data.embedToken,
          files: [
            {
              localId: "voice-test",
              filename: "sample.wav",
              mimeType: "audio/wav",
              sizeBytes: 16044,
            },
          ],
          clientMessageId: randomUUID(),
        },
      },
    );
    expect(denied.status()).toBe(400);
    expect((await denied.json()).error.message).toContain("disabled");
  } finally {
    await restore();
    await operatorContext.close();
    await visitorContext.close();
  }
});

test("visitor records, reviews and sends voice; both parties can play audio attachments", async () => {
  // Synthetic capture device: never accesses the developer's real microphone.
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const operatorContext = await browser.newContext();
  const visitorContext = await browser.newContext({ permissions: ["microphone"] });
  const operator = await operatorContext.newPage();
  const visitor = await visitorContext.newPage();
  const restore = await prepare(operator);
  const marker = `Voice test ${String(Date.now())}`;
  try {
    await save(operator);
    await openWidget(visitor);
    const frame = widgetFrameLocator(visitor);
    await frame.getByRole("button", { name: "Record voice message", exact: true }).click();
    await expect(frame.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
    await expect(frame.getByRole("status").filter({ hasText: "Recording" })).toContainText("0:01");
    await frame.getByRole("button", { name: "Stop recording", exact: true }).click();
    await expect(frame.getByLabel("Review voice message")).toBeVisible();
    await frame
      .getByLabel("Review voice message")
      .evaluate((element: HTMLAudioElement) => element.play());
    await expect
      .poll(() =>
        frame
          .getByLabel("Review voice message")
          .evaluate((element: HTMLAudioElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await frame.getByRole("button", { name: "Attach voice message", exact: true }).click();
    await frame.getByRole("textbox").fill(marker);
    await frame.getByRole("button", { name: "Send", exact: true }).click();
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await openOperatorConversation(operator, marker);
    const player = operator.getByTestId("operator-voice-message-player");
    await expect(player).toBeVisible();
    await player.evaluate((element: HTMLAudioElement) => element.play());
    await expect
      .poll(() => player.evaluate((element: HTMLAudioElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await operator
      .getByTestId("operator-file-input")
      .setInputFiles(path.join(process.cwd(), "e2e/fixtures/sample.wav"));
    await expect(operator.getByTestId("operator-pending-attachments")).toBeVisible();
    await operatorReplyComposer(operator).fill(`Audio reply ${marker}`);
    await operator.getByRole("button", { name: "Send reply", exact: true }).click();
    const replyPlayer = frame.getByLabel("Voice message sample.wav", { exact: true });
    await expect(replyPlayer).toBeVisible();
    await replyPlayer.evaluate((element: HTMLAudioElement) => element.play());
    await expect
      .poll(() => replyPlayer.evaluate((element: HTMLAudioElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await visitor.locator('iframe[title="Mill"]').screenshot({
      path: test.info().outputPath("voice-message-delivered.png"),
    });
  } finally {
    await restore();
    await browser.close();
  }
});
