import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  customer: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@/lib/platform-admin/guard", () => ({
  requirePlatformAdministrator: mocks.guard,
}));
vi.mock("@/lib/billing/chargebee", () => ({
  chargebeeCustomer: mocks.customer,
  downloadChargebeeInvoice: mocks.download,
}));
import { GET } from "@/app/api/admin/customers/[workspaceId]/invoices/[invoiceId]/route";
const workspaceId = "69a1d371-0b57-4d7f-be9a-9b8f6eb50f27";
const context = {
  params: Promise.resolve({ workspaceId, invoiceId: "invoice-1" }),
};
describe("platform invoice access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue({ role: "owner" });
    mocks.customer.mockResolvedValue("mapped-customer");
    mocks.download.mockResolvedValue({
      bytes: new TextEncoder().encode("%PDF-test").buffer,
      filename: "invoice-1.pdf",
    });
  });
  it("denies support staff before loading a customer's payment data", async () => {
    mocks.guard.mockResolvedValue({ role: "support" });
    const result = await GET(new Request("https://app.mill.chat"), context);
    expect(result.status).toBe(404);
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("ignores a client-supplied customer and uses the authorised workspace mapping", async () => {
    const result = await GET(
      new Request("https://app.mill.chat?customer=another-company"),
      context,
    );
    expect(result.status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith(
      workspaceId,
      "mapped-customer",
      "invoice-1",
    );
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects invalid workspace identifiers without making a provider request", async () => {
    const result = await GET(new Request("https://app.mill.chat"), {
      params: Promise.resolve({
        workspaceId: "../another-company",
        invoiceId: "invoice-1",
      }),
    });
    expect(result.status).toBe(404);
    expect(mocks.customer).not.toHaveBeenCalled();
  });
});
