import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  APP_URL,
  WORKSPACE_SLUG,
  loginOperator,
  openWidget,
  widgetFrameLocator,
  openOperatorConversation,
  sendOperatorReply,
} from "../../helpers";
// Small valid PNG, synthetic fixture: no personal photo or live mailbox.
function avatarPng() {
  const crc = (b: Buffer) => {
    let n = 0xffffffff;
    for (const byte of b) {
      n ^= byte;
      for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((64 * 3 + 1) * 64))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
test("personal agent identity, closed conversation, optional rating and transcript controls", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const oc = await browser.newContext();
  const vc = await browser.newContext();
  const operator = await oc.newPage();
  const visitor = await vc.newPage();
  const setupUrl = `${APP_URL}/app/${WORKSPACE_SLUG}/settings/chat-setup`;
  const profileUrl = `${APP_URL}/app/${WORKSPACE_SLUG}/settings/profile`;
  const marker = `Wrap-up ${Date.now()}`;
  const reply = `Reply ${marker}`;
  await loginOperator(operator);
  await operator.goto(profileUrl);
  const originalName = await operator.getByLabel("Display name").inputValue();
  await operator.getByLabel("Display name").fill("Alice from Mill");
  await operator
    .getByLabel("Profile photo", { exact: true })
    .setInputFiles({ name: "agent.png", mimeType: "image/png", buffer: avatarPng() });
  await operator.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(operator.getByRole("status")).toHaveText("Profile saved.");
  await operator.screenshot({ path: test.info().outputPath("agent-profile.png"), fullPage: true });
  await operator.goto(setupUrl);
  const form = operator.getByRole("checkbox", {
    name: "Ask visitors to fill in a form before chatting",
  });
  const rating = operator.getByRole("checkbox", {
    name: "Ask visitors to rate completed conversations",
  });
  const transcript = operator.getByRole("checkbox", {
    name: "Allow visitors to email themselves a transcript",
  });
  const original = {
    form: await form.isChecked(),
    rating: await rating.isChecked(),
    transcript: await transcript.isChecked(),
  };
  const save = async () => {
    await operator.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(operator.getByRole("status")).toHaveText("Settings saved.");
  };
  let embedToken = "";
  let sessionToken = "";
  let conversationId = "";
  try {
    await form.uncheck();
    await rating.check();
    await transcript.check();
    await save();
    const bootstrapPromise = visitor.waitForResponse(
      (r) => r.url().includes("/api/v1/widget/bootstrap") && r.request().method() === "GET",
    );
    const sessionPromise = visitor.waitForResponse(
      (r) => r.url().includes("/api/v1/widget/session") && r.request().method() === "POST",
    );
    await openWidget(visitor);
    embedToken = (await (await bootstrapPromise).json()).data.embedToken;
    sessionToken = (await (await sessionPromise).json()).data.sessionToken;
    const frame = widgetFrameLocator(visitor);
    await frame.getByRole("textbox", { name: "Type your message…", exact: true }).fill(marker);
    await frame.getByRole("button", { name: "Send", exact: true }).click();
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await openOperatorConversation(operator, marker);
    conversationId = operator.url().split("/").pop()!;
    await sendOperatorReply(operator, reply);
    await expect(frame.getByText(reply, { exact: true })).toBeVisible();
    await expect(frame.getByText(/Alice from Mill ·/).last()).toBeVisible({ timeout: 30000 });
    const avatar = frame
      .getByTestId("agent-message")
      .filter({ hasText: reply })
      .locator("..")
      .locator("img");
    await expect(avatar).toBeVisible();
    await expect
      .poll(() => avatar.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await operator.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(frame.getByTestId("widget-conversation-closed")).toBeVisible({ timeout: 30000 });
    await visitor.setViewportSize({ width: 390, height: 844 });
    await visitor
      .locator('iframe[title="Mill"]')
      .screenshot({ path: test.info().outputPath("closed-widget-rating-mobile.png") });
    await frame.getByRole("button", { name: "Rate 5 out of 5", exact: true }).click();
    await frame.getByLabel("Feedback (optional)").fill("Great service.");
    await frame.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect(frame.getByTestId("widget-rating-thanks")).toContainText("5/5");
    await expect(operator.getByTestId("conversation-rating")).toContainText("5/5", {
      timeout: 30000,
    });
    await visitor
      .locator('iframe[title="Mill"]')
      .screenshot({ path: test.info().outputPath("closed-widget.png") });
    // A forged conversation ID cannot request somebody else's transcript.
    const denied = await vc.request.post(`${APP_URL}/api/v1/widget/conversation`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-SiteChat-Embed-Token": embedToken,
        Origin: APP_URL,
      },
      data: {
        action: "transcript",
        conversationId: randomUUID(),
        requestId: randomUUID(),
        email: "synthetic@example.com",
      },
    });
    expect(denied.status()).toBe(409);
    // Real email is deliberately disabled locally; the UI must show a useful failure.
    await frame.getByRole("button", { name: "Email me this conversation", exact: true }).click();
    await frame.getByLabel("Your email address", { exact: true }).fill("synthetic@example.com");
    await frame.getByRole("button", { name: "Send transcript", exact: true }).click();
    await expect(frame.getByText(/Transcript email is not configured/)).toBeVisible();
    await operator.goto(profileUrl);
    await operator.getByRole("button", { name: "Remove photo", exact: true }).click();
    await operator.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(operator.getByRole("status")).toHaveText("Profile saved.");
    await expect(operator.getByRole("img", { name: "Your current profile photo" })).toHaveCount(0);
    await operator.goto(setupUrl);
    await rating.uncheck();
    await transcript.uncheck();
    await save();
    await expect(
      frame.getByRole("button", { name: "Email me this conversation", exact: true }),
    ).toHaveCount(0, { timeout: 30000 });
    await expect(frame.getByTestId("widget-rating-thanks")).toHaveCount(0);
    await expect(frame.getByTestId("widget-conversation-closed")).toBeVisible();
    const blocked = await vc.request.post(`${APP_URL}/api/v1/widget/conversation`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-SiteChat-Embed-Token": embedToken,
        Origin: APP_URL,
      },
      data: { action: "rating", conversationId, score: 1, comment: "forged" },
    });
    expect(blocked.status()).toBe(400);
    // Closing must still let the same visitor start another conversation.
    const nextMessage = `New chat ${marker}`;
    await frame.getByRole("textbox", { name: "Type your message…", exact: true }).fill(nextMessage);
    await frame.getByRole("button", { name: "Send", exact: true }).click();
    await expect(frame.getByText(nextMessage, { exact: true })).toBeVisible();
    await expect(frame.getByTestId("widget-conversation-closed")).toHaveCount(0, {
      timeout: 30000,
    });
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await openOperatorConversation(operator, nextMessage);
    await expect(operator.getByText(nextMessage, { exact: true }).last()).toBeVisible();
    const panel = operator.getByTestId("conversation-follow-up");
    await panel.getByRole("textbox").fill("synthetic@example.com");
    await panel.getByRole("button", { name: "Email transcript", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Transcript email is not configured");
  } finally {
    await operator.goto(setupUrl);
    await form.setChecked(original.form);
    await rating.setChecked(original.rating);
    await transcript.setChecked(original.transcript);
    await save();
    await operator.goto(profileUrl);
    await operator.getByLabel("Display name").fill(originalName || "Test operator");
    const remove = operator.getByRole("button", { name: "Remove photo", exact: true });
    if (await remove.count()) await remove.click();
    await operator.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(operator.getByRole("status")).toHaveText("Profile saved.");
    await oc.close();
    await vc.close();
  }
});
