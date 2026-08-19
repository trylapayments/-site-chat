import { expect, test, type Page } from "@playwright/test";

import {
  AGENT_EMAIL,
  APP_URL,
  loginAs,
  loginOperator,
  openWidget,
  VIEWER_EMAIL,
  widgetFrameLocator,
  WORKSPACE_SLUG,
} from "../../helpers";

const DEFAULT_PRIMARY_COLOR = "#0066FF";
const PREVIEW_PRIMARY_COLOR = "#7C3AED";
const SAVED_DRAFT_COLOR = "#C2410C";
const PUBLISHED_PRIMARY_COLOR = "#0F766E";
const UNPUBLISHED_PRIMARY_COLOR = "#BE123C";

type BootstrapPayload = {
  data: {
    config: {
      position: "bottom-left" | "bottom-right";
      primaryColor: string;
      version: number;
      showPoweredBy: boolean;
    };
  };
};

async function openOwnerStudio(page: Page): Promise<void> {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/widget-studio`);
  await expect(page.getByTestId("widget-studio-manager")).toBeVisible({
    timeout: 30_000,
  });
}

async function openReadonlyStudio(page: Page, email: string): Promise<void> {
  await loginAs(page, email);
  await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/widget-studio`);
  await expect(page.getByTestId("widget-studio-manager")).toBeVisible({
    timeout: 30_000,
  });
}

async function setPrimaryColor(page: Page, color: string): Promise<void> {
  const normalized = color.toUpperCase();
  const input = page.getByTestId("widget-studio-primary-color");
  await input.fill(normalized);
  await expect(page.getByTestId("widget-studio-preview-panel")).toHaveAttribute(
    "data-primary-color",
    normalized,
    { timeout: 10_000 },
  );
}

async function acceptNextConfirmation(page: Page): Promise<void> {
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
}

async function resetDraft(page: Page): Promise<void> {
  await acceptNextConfirmation(page);
  await page.getByTestId("widget-studio-reset").click();
  await expect(page.getByText("Draft reset to defaults.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function publishDraft(page: Page): Promise<void> {
  await page.getByTestId("widget-studio-publish").click();
  await expect(page.getByText("Published to production.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

async function openProductionWidget(page: Page): Promise<BootstrapPayload> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/widget/bootstrap") && response.request().method() === "GET",
    { timeout: 60_000 },
  );

  await openWidget(page);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return (await response.json()) as BootstrapPayload;
}

test.describe.serial("Widget Studio", () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openOwnerStudio(page);
    await resetDraft(page);
    await publishDraft(page);
    await context.close();
  });

  test("opens from Settings", async ({ page }) => {
    await loginOperator(page);
    await page.goto(`${APP_URL}/app/${WORKSPACE_SLUG}/settings`);
    await page.getByTestId("settings-link-widget-studio").click();

    await expect(page).toHaveURL(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/widget-studio`);
    await expect(page.getByTestId("widget-studio-manager")).toBeVisible();
    await expect(page.getByTestId("widget-studio-preview")).toBeVisible();
  });

  test("updates the live preview before publish", async ({ page }) => {
    await openOwnerStudio(page);
    await setPrimaryColor(page, PREVIEW_PRIMARY_COLOR);

    await expect(page.getByTestId("widget-studio-dirty-badge")).toHaveAttribute(
      "data-dirty",
      "true",
    );
    await expect(page.getByTestId("widget-studio-save-draft")).toBeEnabled();
  });

  test("saves a draft", async ({ page }) => {
    await openOwnerStudio(page);
    await setPrimaryColor(page, SAVED_DRAFT_COLOR);
    await page.getByTestId("widget-studio-save-draft").click();

    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("widget-studio-primary-color")).toHaveValue(
      SAVED_DRAFT_COLOR.toUpperCase(),
    );
    await expect(page.getByTestId("widget-studio-dirty-badge")).toHaveAttribute(
      "data-dirty",
      "true",
    );
  });

  test("publishes and production bootstrap reflects the primary color", async ({
    browser,
    page,
  }) => {
    await openOwnerStudio(page);
    await setPrimaryColor(page, PUBLISHED_PRIMARY_COLOR);
    await publishDraft(page);

    await expect(page.getByTestId("widget-studio-dirty-badge")).toHaveAttribute(
      "data-dirty",
      "false",
    );

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const bootstrap = await openProductionWidget(visitor);
    expect(bootstrap.data.config.primaryColor).toBe(PUBLISHED_PRIMARY_COLOR);

    const widgetRoot = widgetFrameLocator(visitor).locator(".sitechat-widget");
    await expect(widgetRoot).toHaveAttribute(
      "data-config-version",
      String(bootstrap.data.config.version),
    );
    await expect
      .poll(() =>
        widgetRoot.evaluate((element) => element.style.getPropertyValue("--widget-primary")),
      )
      .toBe(PUBLISHED_PRIMARY_COLOR);
    await visitorContext.close();
  });

  test("keeps an unpublished saved draft out of production", async ({ browser, page }) => {
    await openOwnerStudio(page);
    await setPrimaryColor(page, UNPUBLISHED_PRIMARY_COLOR);
    await page.getByTestId("widget-studio-save-draft").click();
    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const bootstrap = await openProductionWidget(visitor);
    expect(bootstrap.data.config.primaryColor).toBe(PUBLISHED_PRIMARY_COLOR);

    const widgetRoot = widgetFrameLocator(visitor).locator(".sitechat-widget");
    await expect
      .poll(() =>
        widgetRoot.evaluate((element) => element.style.getPropertyValue("--widget-primary")),
      )
      .toBe(PUBLISHED_PRIMARY_COLOR);
    await visitorContext.close();
  });

  test("resets the draft to defaults", async ({ page }) => {
    await openOwnerStudio(page);
    await resetDraft(page);

    await expect(page.getByTestId("widget-studio-primary-color")).toHaveValue(
      DEFAULT_PRIMARY_COLOR.toUpperCase(),
    );
    await expect(page.getByTestId("widget-studio-preview-panel")).toHaveAttribute(
      "data-primary-color",
      DEFAULT_PRIMARY_COLOR,
    );
  });

  test("previews bottom-left and bottom-right positions", async ({ page }) => {
    await openOwnerStudio(page);
    const position = page.getByTestId("widget-studio-position");
    const preview = page.getByTestId("widget-studio-preview-panel");

    await position.selectOption("bottom-left");
    await expect(preview).toHaveAttribute("data-position", "bottom-left");
    await position.selectOption("bottom-right");
    await expect(preview).toHaveAttribute("data-position", "bottom-right");
    await expect(page.getByTestId("widget-studio-preview-launcher")).toBeVisible();
  });

  test("switches the preview to the phone viewport", async ({ page }) => {
    await openOwnerStudio(page);
    await page.getByTestId("widget-studio-viewport-phone").click();

    await expect(page.getByTestId("widget-studio-viewport-phone")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("widget-studio-preview-panel")).toHaveAttribute(
      "data-viewport",
      "phone",
    );
  });

  test("renders the Hebrew preview right-to-left", async ({ page }) => {
    await openOwnerStudio(page);
    await page.getByRole("button", { name: "עברית RTL" }).click();

    await expect(page.getByTestId("widget-studio-preview-panel")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("widget-studio-preview")).toContainText("היי! איך אפשר לעזור?");
  });

  test("previews English custom copy without replacing Hebrew defaults", async ({ page }) => {
    await openOwnerStudio(page);
    const customWelcome = `Welcome from Studio ${Date.now()}`;
    await page.getByLabel("Welcome message (English)").fill(customWelcome);
    await expect(page.getByTestId("widget-studio-preview")).toContainText(customWelcome);

    await page.getByRole("button", { name: "עברית RTL" }).click();
    await expect(page.getByTestId("widget-studio-preview")).toContainText("היי! איך אפשר לעזור?");
    await expect(page.getByTestId("widget-studio-preview")).not.toContainText(customWelcome);
  });

  test("discards draft changes back to the published config", async ({ page }) => {
    await openOwnerStudio(page);
    await setPrimaryColor(page, SAVED_DRAFT_COLOR);
    await page.getByTestId("widget-studio-save-draft").click();
    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByTestId("widget-studio-discard").click();
    await expect(page.getByText("Draft discarded.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("marks business hours as foundation-only", async ({ page }) => {
    await openOwnerStudio(page);
    await expect(page.getByTestId("widget-studio-business-hours-foundation")).toBeVisible();
    await expect(page.getByText("Business hours (foundation)", { exact: true })).toBeVisible();
  });

  test("rejects non-raster asset uploads", async ({ page }) => {
    await openOwnerStudio(page);
    await page.getByTestId("widget-studio-asset-logo").setInputFiles({
      name: "evil.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        "utf8",
      ),
    });

    await expect(page.getByTestId("widget-studio-error")).toContainText(
      "Use a PNG, JPEG, or WebP image.",
      { timeout: 30_000 },
    );
  });

  test("uploads a verified PNG logo into the draft", async ({ page }) => {
    await openOwnerStudio(page);
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByTestId("widget-studio-asset-logo").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: png,
    });

    await expect(page.getByTestId("widget-studio-notice")).toContainText("Asset uploaded", {
      timeout: 60_000,
    });
  });

  test("forces powered-by branding on production without white-label entitlement", async ({
    browser,
    page,
  }) => {
    await openOwnerStudio(page);
    await page.locator("#studio-powered-by").uncheck();
    await publishDraft(page);

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const bootstrap = await openProductionWidget(visitor);
    expect(bootstrap.data.config.showPoweredBy).toBe(true);
    await visitorContext.close();
  });

  test("applies system color mode in the studio preview", async ({ page }) => {
    await openOwnerStudio(page);
    await page.getByTestId("widget-studio-color-mode").selectOption("system");
    await expect(page.getByTestId("widget-studio-preview-panel")).toHaveAttribute(
      "data-color-mode",
      "system",
    );
  });

  test("rejects a stale publish with CAS conflict", async ({ browser, page }) => {
    await openOwnerStudio(page);
    await setPrimaryColor(page, "#0EA5E9");

    const rivalContext = await browser.newContext();
    const rival = await rivalContext.newPage();
    await openOwnerStudio(rival);
    await setPrimaryColor(rival, "#F97316");
    await publishDraft(rival);
    await rivalContext.close();

    await page.getByTestId("widget-studio-publish").click();
    await expect(page.getByTestId("widget-studio-error")).toContainText(/Publish conflict/i, {
      timeout: 30_000,
    });
  });

  test("keeps viewers and agents read-only", async ({ browser }) => {
    for (const email of [VIEWER_EMAIL, AGENT_EMAIL]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await openReadonlyStudio(page, email);

      await expect(page.getByTestId("widget-studio-readonly-banner")).toBeVisible();
      await expect(page.getByTestId("widget-studio-save-draft")).toBeDisabled();
      await expect(page.getByTestId("widget-studio-publish")).toBeDisabled();
      await expect(page.getByTestId("widget-studio-discard")).toBeDisabled();
      await expect(page.getByTestId("widget-studio-reset")).toBeDisabled();
      await expect(page.getByTestId("widget-studio-primary-color")).toBeDisabled();
      await context.close();
    }
  });

  test("stays scoped to the acme-support workspace URL", async ({ page }) => {
    await openOwnerStudio(page);

    await expect(page).toHaveURL(`${APP_URL}/app/${WORKSPACE_SLUG}/settings/widget-studio`);
    await expect(page.getByTestId("widget-studio-manager")).toBeVisible();
  });
});
