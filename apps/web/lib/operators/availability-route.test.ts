import { beforeEach, expect, it, vi } from "vitest";
const { verify, status, rate } = vi.hoisted(() => ({
  verify: vi.fn(),
  status: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/widget/context", () => ({ verifyEmbedContext: verify }));
vi.mock("@/lib/widget/embed-token", () => ({
  createRequestId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/lib/operators/availability", () => ({
  workspaceOperatorStatus: status,
}));
vi.mock("@/lib/widget/service", () => ({ consumeWidgetRateLimit: rate }));
import { POST } from "@/app/api/v1/widget/availability/route";
beforeEach(() => {
  vi.clearAllMocks();
  verify.mockResolvedValue({ workspaceId: "workspace-a" });
  rate.mockResolvedValue(true);
  status.mockResolvedValue("available");
});
function request(body: unknown) {
  return new Request("http://localhost/api/v1/widget/availability", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
it("does not read availability without a verified embed", async () => {
  verify.mockResolvedValue(null);
  expect((await POST(request({ embedToken: "invalid" }))).status).toBe(403);
  expect(status).not.toHaveBeenCalled();
});
it("only exposes the aggregate for the verified workspace, without caching", async () => {
  const result = await POST(request({ embedToken: "valid" }));
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  const body: unknown = await result.json();
  expect(body).toMatchObject({ data: { status: "available" } });
  expect(status).toHaveBeenCalledWith("workspace-a");
  expect(
    (await POST(request({ embedToken: "valid", workspaceId: "other" }))).status,
  ).toBe(400);
});
it("limits repeated requests before querying availability", async () => {
  rate.mockResolvedValue(false);
  expect((await POST(request({ embedToken: "valid" }))).status).toBe(429);
  expect(status).not.toHaveBeenCalled();
});
