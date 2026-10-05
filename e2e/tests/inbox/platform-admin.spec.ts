import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdir } from "node:fs/promises";
import { APP_URL, OPERATOR_EMAIL, WORKSPACE_SLUG, loginOperator } from "../../helpers";
test("tenant owner is denied; platform owner edits a real company with audit history", async ({
  page,
}) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):/.test(url))
    throw new Error("Platform permissions fixture is restricted to local Supabase.");
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  const { data: users, error: userError } = await service.auth.admin.listUsers();
  if (userError) throw userError;
  const user = users.users.find((u) => u.email === OPERATOR_EMAIL);
  if (!user) throw new Error("Seeded operator unavailable.");
  const { data: workspace, error: workspaceError } = await service
    .from("workspaces")
    .select("id,name")
    .eq("slug", WORKSPACE_SLUG)
    .single();
  if (workspaceError) throw workspaceError;
  const { data: existing } = await service
    .from("platform_administrators")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const { error: clearError } = await service
    .from("platform_administrators")
    .delete()
    .eq("user_id", user.id);
  if (clearError) throw clearError;
  try {
    await loginOperator(page);
    await page.goto(`${APP_URL}/admin/customers`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    const { error: grantError } = await service
      .from("platform_administrators")
      .upsert({ user_id: user.id, role: "owner", enabled: true });
    if (grantError) throw grantError;
    await page.goto(`${APP_URL}/admin/customers`);
    await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
    await page.getByRole("link", { name: workspace.name, exact: true }).click();
    await expect(page.getByRole("heading", { name: workspace.name, exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    const marker = `Platform E2E ${Date.now()}`;
    await page.getByLabel("New note").fill(marker);
    await page.getByLabel("Reason for this change").fill("Verify an audited platform change");
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("recorded in the audit log");
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await expect(
      page.getByText("Verify an audited platform change", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Company", exact: true }).click();
    await expect(page.getByLabel("Workspace name")).toHaveValue(workspace.name);
    const dir =
      "/Users/antonlevy/Documents/Codex/2026-10-03/users-antonlevy-downloads-site-chat-e2e/outputs/mill-platform-admin";
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/company.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await expect(page.getByLabel("New note")).toBeVisible();
    await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  } finally {
    if (existing) await service.from("platform_administrators").upsert(existing);
    else await service.from("platform_administrators").delete().eq("user_id", user.id);
  }
});
