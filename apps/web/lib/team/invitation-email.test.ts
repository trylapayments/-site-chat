import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sendTeamInvitationEmail } from "./invitation-email";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const input = { email: "agent@example.com", role: "agent", workspaceName: "Team <One>", url: "https://app.mill.chat/invite/test", invitationId: "test-id" };
it("sends the actual invitation link with escaped workspace name and an idempotency key", async () => {
 vi.stubEnv("RESEND_API_KEY", "test-only");
 const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetch);
 await sendTeamInvitationEmail(input);
 const options = fetch.mock.calls[0]?.[1] as { headers: Record<string, string>; body: string };
 expect(options.headers["Idempotency-Key"]).toBe("team-invite:test-id");
 const body = JSON.parse(options.body) as { to: string[]; html: string };
 expect(body.to).toEqual([input.email]);
 expect(body.html).toContain(input.url); expect(body.html).toContain("Team &lt;One&gt;");
});
it("reports provider failure instead of pretending the invitation was emailed", async () => {
 vi.stubEnv("RESEND_API_KEY", "test-only"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
 await expect(sendTeamInvitationEmail(input)).rejects.toThrow("Invitation email failed");
});
