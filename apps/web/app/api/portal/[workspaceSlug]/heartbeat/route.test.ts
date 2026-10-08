import { beforeEach, describe, expect, it, vi } from "vitest";
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/operators/actions", () => ({
  updateOperatorAvailability: update,
}));
import { POST } from "./route";
const context = {
  params: Promise.resolve({ workspaceSlug: "test-workspace" }),
};
function request(origin: string | null, body: unknown) {
  return new Request(
    "https://app.mill.chat/api/portal/test-workspace/heartbeat",
    {
      method: "POST",
      headers: origin ? { origin, "Content-Type": "application/json" } : {},
      body: JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  update.mockReset();
});
describe("portal heartbeat", () => {
  it("rejects missing and cross-origin requests before any mutation", async () => {
    for (const origin of [null, "https://other.example"]) {
      expect(
        (await POST(request(origin, { active: true }), context)).status,
      ).toBe(403);
    }
    expect(update).not.toHaveBeenCalled();
  });
  it("does not allow a heartbeat to overwrite a manual status", async () => {
    expect(
      (
        await POST(
          request("https://app.mill.chat", {
            active: true,
            status: "available",
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it("uses the authorized availability service and prevents response caching", async () => {
    update.mockResolvedValue({ status: "away" });
    const response = await POST(
      request("https://app.mill.chat", { active: false }),
      context,
    );
    expect(update).toHaveBeenCalledWith("test-workspace", { active: false });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ status: "away" });
  });
  it("does not expose details on denied access or backend failure", async () => {
    update.mockRejectedValue(new Error("private access error"));
    const response = await POST(
      request("https://app.mill.chat", { active: true }),
      context,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private access error");
  });
});
