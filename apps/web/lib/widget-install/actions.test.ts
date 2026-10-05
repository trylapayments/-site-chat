import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  capability: vi.fn(),
  client: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/widget-studio/guards", () => ({
  requireWidgetStudioWorkspace: mocks.guard,
}));
vi.mock("@/lib/permissions/require-capability", () => ({
  requireCapability: mocks.capability,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: mocks.client,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { setInstallDomainAction } from "./actions";
describe("install domain access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue({
      workspace: { workspace_id: "trusted-workspace", role: "owner" },
    });
    mocks.client.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ upsert: mocks.upsert });
    mocks.upsert.mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "row", domain: "example.com", verified: true },
            error: null,
          }),
      }),
    });
  });
  it("scopes approved domains to the authenticated workspace, never caller IDs", async () => {
    expect(
      (
        await setInstallDomainAction("mine", {
          domain: "Example.com",
          enabled: true,
        })
      ).success,
    ).toBe(true);
    expect(mocks.capability).toHaveBeenCalledWith(
      "owner",
      "manage_widget_studio",
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      {
        workspace_id: "trusted-workspace",
        domain: "example.com",
        verified: true,
      },
      { onConflict: "workspace_id,domain" },
    );
  });
  it("does not access privileged storage if management permission is denied", async () => {
    mocks.capability.mockImplementation(() => {
      throw new Error("denied");
    });
    expect(
      (
        await setInstallDomainAction("mine", {
          domain: "example.com",
          enabled: true,
        })
      ).success,
    ).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects injected workspace IDs", async () => {
    expect(
      (
        await setInstallDomainAction("mine", {
          domain: "example.com",
          enabled: true,
          workspace_id: "other",
        })
      ).success,
    ).toBe(false);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
  it("revokes access by disabling approval without deleting data", async () => {
    await setInstallDomainAction("mine", {
      domain: "example.com",
      enabled: false,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      {
        workspace_id: "trusted-workspace",
        domain: "example.com",
        verified: false,
      },
      { onConflict: "workspace_id,domain" },
    );
  });
});
