import { expect, test, type Page } from "@playwright/test";

import {
  APP_URL,
  loginOperator,
  openOperatorConversation,
  SEEDED_OPEN_CONVERSATION_PREVIEW,
  waitForOperatorInboxRealtimeReady,
  waitForOperatorThreadRealtimeReady,
} from "../../helpers";

type Box = { x: number; y: number; w: number; h: number };

type LayoutSnapshot = {
  bodyPad: string;
  bodyOverflow: string;
  htmlOverflow: string;
  bodyStyle: string;
  docClientW: number;
  docScrollW: number;
  sidebar: Box | null;
  list: Box | null;
  thread: Box | null;
  inspector: Box | null;
  shell: Box | null;
};

const TOLERANCE_PX = 1;

async function measureLayout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) {
        return null;
      }
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };

    return {
      bodyPad: getComputedStyle(document.body).paddingRight,
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyStyle: document.body.getAttribute("style") ?? "",
      docClientW: document.documentElement.clientWidth,
      docScrollW: document.documentElement.scrollWidth,
      sidebar: box(document.querySelector('[data-testid="inbox-global-sidebar"]')),
      list: box(document.querySelector('[data-testid="inbox-conversation-list"]')),
      thread: box(document.querySelector('[data-testid="conversation-thread"]')),
      inspector: box(document.querySelector('[data-testid="customer-inspector"]')),
      shell: box(document.querySelector('[data-testid="dashboard-operator-shell"]')),
    };
  });
}

function assertStableBoxes(baseline: LayoutSnapshot, next: LayoutSnapshot, label: string) {
  const keys = ["sidebar", "list", "thread", "inspector", "shell"] as const;
  for (const key of keys) {
    const a = baseline[key];
    const b = next[key];
    expect(a, `${label} ${key} baseline`).toBeTruthy();
    expect(b, `${label} ${key} sample`).toBeTruthy();
    if (!a || !b) {
      continue;
    }
    expect(Math.abs(a.x - b.x), `${label} ${key}.x`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(a.w - b.w), `${label} ${key}.w`).toBeLessThanOrEqual(TOLERANCE_PX);
  }
  expect(next.docClientW, `${label} document client width`).toBe(baseline.docClientW);
  expect(next.bodyPad, `${label} body padding-right`).toBe(baseline.bodyPad);
  expect(next.bodyStyle.includes("padding"), `${label} body style padding`).toBe(false);
}

test("inbox chrome geometry stays stable while idle", async ({ page }) => {
  await loginOperator(page);
  await page.goto(`${APP_URL}/app/acme-support/inbox`);
  await waitForOperatorInboxRealtimeReady(page);
  await openOperatorConversation(page, SEEDED_OPEN_CONVERSATION_PREVIEW);
  await waitForOperatorInboxRealtimeReady(page);
  await waitForOperatorThreadRealtimeReady(page);
  await page.waitForTimeout(2_000);

  const baseline = await measureLayout(page);
  expect(baseline.sidebar?.w, "sidebar width").toBeGreaterThan(200);
  expect(baseline.shell, "operator shell").toBeTruthy();

  const bodyMutations: string[] = [];
  await page.evaluate(() => {
    (window as unknown as { __bodyMut?: string[] }).__bodyMut = [];
    const obs = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target === document.body || record.target === document.documentElement) {
          const el = record.target as HTMLElement;
          (window as unknown as { __bodyMut: string[] }).__bodyMut.push(
            `${el === document.body ? "body" : "html"}:${record.attributeName}=${el.getAttribute(record.attributeName) ?? ""}`,
          );
        }
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  });

  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(1_000);
    const sample = await measureLayout(page);
    assertStableBoxes(baseline, sample, `idle +${String(i + 1)}s`);
  }

  const extra = await page.evaluate(
    () => (window as unknown as { __bodyMut?: string[] }).__bodyMut ?? [],
  );
  bodyMutations.push(...extra);
  const paddingMutations = bodyMutations.filter((entry) => /padding|overflow/i.test(entry));
  expect(
    paddingMutations,
    `body/html overflow-padding mutations: ${paddingMutations.join(" | ")}`,
  ).toEqual([]);

  // Height change must not introduce a document scrollbar that shifts columns.
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  if (!viewport) {
    return;
  }
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 40 });
  await page.waitForTimeout(250);
  const shorter = await measureLayout(page);
  expect(Math.abs((shorter.sidebar?.x ?? 0) - (baseline.sidebar?.x ?? 0))).toBeLessThanOrEqual(
    TOLERANCE_PX,
  );
  expect(Math.abs((shorter.sidebar?.w ?? 0) - (baseline.sidebar?.w ?? 0))).toBeLessThanOrEqual(
    TOLERANCE_PX,
  );
  expect(Math.abs((shorter.thread?.x ?? 0) - (baseline.thread?.x ?? 0))).toBeLessThanOrEqual(
    TOLERANCE_PX,
  );
  expect(shorter.docClientW).toBe(baseline.docClientW);
});
