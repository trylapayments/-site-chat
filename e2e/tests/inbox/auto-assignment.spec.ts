import { expect, test } from "@playwright/test";
import {
  APP_URL,
  loginOperator,
  openWidget,
  sendWidgetMessage,
  openOperatorConversation,
  assignmentHeader,
  widgetFrameLocator,
} from "../../helpers";

test("first agent reply claims a chat and Mine/Unassigned remain disjoint across navigation", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const visitorContext = await browser.newContext();
  const agentContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    const agent = await agentContext.newPage();
    const marker = `auto-assign-${Date.now()}`;
    await openWidget(visitor);
    await sendWidgetMessage(visitor, marker);
    await loginOperator(agent);
    await agent.goto(`${APP_URL}/app/acme-support/inbox?assignment=unassigned`);
    await openOperatorConversation(agent, marker);
    await expect(assignmentHeader(agent).getByTestId("assignment-current")).toHaveText(
      /Unassigned/i,
    );
    const conversationId = new URL(agent.url()).pathname.split("/").pop()!;
    const conversationRow = agent.locator(`[data-conversation-id="${conversationId}"]`);
    await agent.getByPlaceholder("Write a reply...").fill("I am here to help.");
    await agent.getByRole("button", { name: "Send reply", exact: true }).click();
    await expect(assignmentHeader(agent).getByTestId("assignment-current")).not.toHaveText(
      /Unassigned/i,
      { timeout: 30_000 },
    );
    await expect(
      widgetFrameLocator(visitor).getByText("I am here to help.", { exact: true }),
    ).toBeVisible();
    await agent.getByTestId("inbox-assignment-tab-assigned_to_me").click();
    await expect(conversationRow).toBeVisible();
    await expect(agent.getByRole("row").filter({ hasText: "Unassigned" })).toHaveCount(0);
    await agent.getByTestId("inbox-assignment-tab-unassigned").click();
    await expect(conversationRow).toHaveCount(0);
    for (const row of await agent.locator("[data-conversation-id]").all()) {
      await expect(row.getByTestId("inbox-row-assignee")).toHaveText("Unassigned");
    }
    await agent.getByTestId("inbox-assignment-tab-all").click();
    await expect(conversationRow).toBeVisible();
  } finally {
    await visitorContext.close();
    await agentContext.close();
  }
});
