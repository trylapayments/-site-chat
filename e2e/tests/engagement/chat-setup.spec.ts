import { expect, test } from "@playwright/test";
import {
  APP_URL,
  WORKSPACE_SLUG,
  loginOperator,
  openWidget,
  widgetFrameLocator,
  openOperatorConversation,
  sendOperatorReply,
} from "../../helpers";

test("custom pre-chat form submits before notifying and preserves its answers", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const visitorContext = await browser.newContext();
  const operator = await context.newPage();
  const visitor = await visitorContext.newPage();
  await loginOperator(operator);
  await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/chat-setup`);
  const marker = String(Date.now());
  const visitorName = `Form visitor ${marker}`;
  const reply = `Thanks for your details. ${marker}`;
  const enabled = operator.getByRole("checkbox", {
    name: "Ask visitors to fill in a form before chatting",
  });
  try {
    const oldFields = operator.getByTestId("pre-chat-custom-field");
    while (await oldFields.count())
      await oldFields
        .last()
        .getByRole("button", { name: /Remove / })
        .click();
    await enabled.check();
    await operator.getByRole("button", { name: "Add field", exact: true }).click();
    const field = operator.getByTestId("pre-chat-custom-field").last();
    await field.getByLabel("Field label", { exact: true }).fill("Company");
    await field.getByRole("checkbox", { name: "Required", exact: true }).check();
    await operator.getByRole("button", { name: "Add field", exact: true }).click();
    const topic = operator.getByTestId("pre-chat-custom-field").last();
    await topic.getByLabel("Field label", { exact: true }).fill("Topic");
    await topic.getByLabel("Field type", { exact: true }).selectOption("select");
    await topic.getByLabel("Choices (one per line)").fill("Sales\nSupport");
    await topic.getByRole("checkbox", { name: "Required", exact: true }).check();
    await topic.getByRole("button", { name: "Move Topic up", exact: true }).click();
    await operator.getByRole("button", { name: "Add field", exact: true }).click();
    const consent = operator.getByTestId("pre-chat-custom-field").last();
    await consent.getByLabel("Field label", { exact: true }).fill("Please contact me");
    await consent.getByLabel("Field type", { exact: true }).selectOption("checkbox");
    await consent.getByRole("checkbox", { name: "Required", exact: true }).check();
    await operator.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(operator.getByRole("status")).toHaveText("Settings saved.");
    await operator.screenshot({ path: test.info().outputPath("chat-setup.png"), fullPage: true });
    await openWidget(visitor, { expectComposer: false });
    const frame = widgetFrameLocator(visitor);
    await expect(frame.getByTestId("widget-pre-chat-form")).toBeVisible();
    await expect(
      frame.getByRole("textbox", { name: "Type your message…", exact: true }),
    ).toHaveCount(0);
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/visitors`);
    await expect(
      operator.getByRole("cell", { name: "browsing", exact: true }).first(),
    ).toBeVisible();
    await frame.getByLabel("Your name").fill(visitorName);
    await frame.getByLabel("Email address").fill(`form-visitor-${marker}@example.com`);
    await frame.getByLabel("Company").fill("Example company");
    await frame.getByLabel("Topic").selectOption("Support");
    await frame.getByLabel("Please contact me").check();
    const orderedFields = await frame
      .getByTestId("widget-pre-chat-form")
      .locator("label")
      .allTextContents();
    expect(orderedFields.findIndex((label) => label.includes("Topic"))).toBeLessThan(
      orderedFields.findIndex((label) => label.includes("Company")),
    );
    await frame.getByRole("button", { name: "Start conversation", exact: true }).click();
    await expect(frame.getByTestId("widget-pre-chat-form")).toHaveCount(0);
    await expect(frame.getByTestId("widget-waiting-acknowledgement")).toBeVisible();
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await openOperatorConversation(operator, visitorName);
    await expect(
      operator.getByTestId("conversation-engagement").getByText("Example company", { exact: true }),
    ).toBeVisible();
    await sendOperatorReply(operator, reply);
    await expect(frame.getByText(reply, { exact: true })).toBeVisible();
    await expect(frame.getByTestId("widget-waiting-acknowledgement")).toHaveCount(0);
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/chat-setup`);
    await operator.getByRole("button", { name: "Remove Company", exact: true }).click();
    await operator.getByRole("button", { name: "Remove Topic", exact: true }).click();
    await operator.getByRole("button", { name: "Remove Please contact me", exact: true }).click();
    await enabled.uncheck();
    await operator.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(operator.getByRole("status")).toHaveText("Settings saved.");
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/inbox`);
    await openOperatorConversation(operator, reply);
    await expect(
      operator.getByTestId("conversation-engagement").getByText("Example company", { exact: true }),
    ).toBeVisible();
  } finally {
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/chat-setup`);
    if (await enabled.isChecked()) {
      await enabled.uncheck();
      await operator.getByRole("button", { name: "Save settings", exact: true }).click();
    }
    await context.close();
    await visitorContext.close();
  }
});

test("operator starts a custom chat with a browsing visitor while widget is closed", async ({
  browser,
}) => {
  const oc = await browser.newContext();
  const vc = await browser.newContext();
  const operator = await oc.newPage();
  const visitor = await vc.newPage();
  try {
    await loginOperator(operator);
    await openWidget(visitor);
    const frame = widgetFrameLocator(visitor);
    await frame.getByRole("button", { name: "Close", exact: true }).click();
    await operator.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/visitors`);
    const row = operator
      .getByRole("row")
      .filter({ has: operator.getByRole("cell", { name: "browsing", exact: true }) })
      .first();
    await expect(row).toBeVisible();
    await row.getByRole("button").click();
    await operator.screenshot({ path: test.info().outputPath("visitors.png"), fullPage: true });
    const invitation = `Can I help you? ${Date.now()}`;
    await operator.getByRole("textbox", { name: "Invitation message" }).fill(invitation);
    await operator.getByRole("button", { name: "Start chat", exact: true }).click();
    await expect(
      operator.getByRole("status").filter({ hasText: "Invitation sent." }),
    ).toBeVisible();
    await expect(frame.getByText(invitation, { exact: true })).toBeVisible({ timeout: 30000 });
  } finally {
    await oc.close();
    await vc.close();
  }
});
