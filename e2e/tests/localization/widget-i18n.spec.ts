import { expect, test } from "@playwright/test";

import {
  openWidget,
  sendWidgetMessage,
  waitForWidgetRealtimeReady,
  widgetComposer,
  widgetFrameLocator,
  HOST_URL,
} from "../../helpers";

type LocaleFixture = {
  locale: string;
  dir: "ltr" | "rtl";
  openLabel: string;
  placeholder: string;
  sendLabel: string;
};

const LOCALES: LocaleFixture[] = [
  {
    locale: "en",
    dir: "ltr",
    openLabel: "Open chat",
    placeholder: "Type your message…",
    sendLabel: "Send",
  },
  {
    locale: "ru",
    dir: "ltr",
    openLabel: "Открыть чат",
    placeholder: "Введите сообщение…",
    sendLabel: "Отправить",
  },
  {
    locale: "he",
    dir: "rtl",
    openLabel: "פתח צ׳אט",
    placeholder: "הקלידו הודעה…",
    sendLabel: "שלח",
  },
  {
    locale: "zh-CN",
    dir: "ltr",
    openLabel: "打开聊天",
    placeholder: "输入消息…",
    sendLabel: "发送",
  },
  {
    locale: "fr",
    dir: "ltr",
    openLabel: "Ouvrir le chat",
    placeholder: "Écrivez votre message…",
    sendLabel: "Envoyer",
  },
];

async function openWidgetWithLocale(page: import("@playwright/test").Page, fixture: LocaleFixture) {
  await page.route("**/api/v1/widget/bootstrap*", async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as {
      data: { config: { locale: string } };
    };
    json.data.config.locale = fixture.locale;
    await route.fulfill({
      status: response.status(),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
  });

  const frame = widgetFrameLocator(page);
  const loaderLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/widget/loader.js") &&
      response.request().method() === "GET" &&
      response.status() === 200,
    { timeout: 60_000 },
  );
  const bootstrapResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/widget/bootstrap") && response.request().method() === "GET",
    { timeout: 60_000 },
  );

  await page.goto(HOST_URL);
  await loaderLoaded;
  expect((await bootstrapResponse).status()).toBe(200);

  await expect(page.locator('iframe[title="Site Chat"]')).toBeAttached({ timeout: 10_000 });

  const launcher = frame.getByRole("button", { name: fixture.openLabel });
  await expect(launcher).toBeVisible({ timeout: 60_000 });
  await launcher.click();
  await expect(frame.getByTestId("widget-realtime-ready")).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByPlaceholder(fixture.placeholder)).toBeVisible({ timeout: 60_000 });
}

test.describe("widget localization", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "widget-chromium", "widget project only");
  });

  for (const fixture of LOCALES) {
    test(`loads ${fixture.locale} chrome and keeps message bodies intact`, async ({ page }) => {
      await openWidgetWithLocale(page, fixture);
      const frame = widgetFrameLocator(page);

      await expect(frame.locator(`[data-widget-locale="${fixture.locale}"]`)).toHaveAttribute(
        "data-widget-dir",
        fixture.dir,
      );
      await expect(frame.locator(`[data-widget-locale="${fixture.locale}"]`)).toHaveAttribute(
        "dir",
        fixture.dir,
      );

      if (fixture.locale === "he") {
        await expect(frame.locator("html")).toHaveAttribute("dir", "rtl");
      }

      const body = `Locale probe ${fixture.locale} ${Date.now()}`;
      await frame.getByPlaceholder(fixture.placeholder).fill(body);
      await frame.getByRole("button", { name: fixture.sendLabel }).click();
      await expect(frame.getByRole("article").getByText(body)).toBeVisible({ timeout: 30_000 });

      // Composer still usable (auto-scroll / layout not broken)
      await expect(frame.getByPlaceholder(fixture.placeholder)).toBeVisible();
      await expect(frame.getByTestId("widget-messages-end")).toBeAttached();
    });
  }

  test("unsupported bootstrap locale falls back to English chrome", async ({ page }) => {
    await page.route("**/api/v1/widget/bootstrap*", async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as {
        data: { config: { locale: string } };
      };
      json.data.config.locale = "xx-INVALID";
      await route.fulfill({
        status: response.status(),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
    });

    await page.goto(HOST_URL);
    const frame = widgetFrameLocator(page);
    await expect(frame.getByRole("button", { name: "Open chat" })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("default English realtime path still works", async ({ page }) => {
    await openWidget(page);
    await waitForWidgetRealtimeReady(page);
    await expect(widgetComposer(page)).toBeVisible();
    await sendWidgetMessage(page, `Default en probe ${Date.now()}`);
  });
});
