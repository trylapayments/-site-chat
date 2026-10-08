import { chatSetupSchema } from "@site-chat/shared";
import { beforeEach, expect, it, vi } from "vitest";
const { verify, status, rate, setup } = vi.hoisted(() => ({
  verify: vi.fn(),
  status: vi.fn(),
  rate: vi.fn(),
  setup: vi.fn(),
}));
vi.mock("@/lib/chat-setup/queries", () => ({ fetchChatSetup: setup }));
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
  verify.mockResolvedValue({
    workspaceId: "workspace-a",
    parentOrigin: "https://example.com",
  });
  rate.mockResolvedValue(true);
  status.mockResolvedValue("available");
  setup.mockResolvedValue({ config: chatSetupSchema.parse({}), version: 0 });
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
  expect(setup).not.toHaveBeenCalled();
});
it("only exposes the aggregate for the verified workspace, without caching", async () => {
  const result = await POST(request({ embedToken: "valid" }));
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  const body: unknown = await result.json();
  expect(body).toMatchObject({ data: { status: "available", visible: true } });
  expect(status).toHaveBeenCalledWith("workspace-a");
  expect(setup).toHaveBeenCalledWith("workspace-a", "https://example.com");
  expect(
    (await POST(request({ embedToken: "valid", workspaceId: "other" }))).status,
  ).toBe(400);
});
it("limits repeated requests before querying availability", async () => {
  rate.mockResolvedValue(false);
  expect((await POST(request({ embedToken: "valid" }))).status).toBe(429);
  expect(status).not.toHaveBeenCalled();
  expect(setup).not.toHaveBeenCalled();
});

it("applies unavailable behavior from the verified workspace settings", async () => {
  setup.mockResolvedValue({
    config: chatSetupSchema.parse({ allOfflineBehavior: "hide" }),
    version: 1,
  });
  status.mockResolvedValue("offline");
  expect(
    await (await POST(request({ embedToken: "valid" }))).json(),
  ).toMatchObject({ data: { status: "offline", visible: false } });
  status.mockResolvedValue("away");
  expect(
    await (await POST(request({ embedToken: "valid" }))).json(),
  ).toMatchObject({ data: { status: "away", visible: true } });
});
