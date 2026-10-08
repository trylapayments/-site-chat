import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInboundSignature, replyToken, incomingReplyText, isAutomatedEmail, mailboxAddress } from "./inbound";

const key = Buffer.alloc(32, 17);
const secret = `whsec_${key.toString("base64")}`;
const now = 1770000000000;
function signed(raw: string) {
  const timestamp = String(now / 1000);
  const signature = createHmac("sha256", key).update(`evt_1.${timestamp}.${raw}`).digest("base64");
  return new Headers({ "svix-id": "evt_1", "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` });
}
describe("incoming conversation email", () => {
  it("accepts signed exact bytes and rejects changed bodies, wrong keys and expired deliveries", () => {
    const raw = '{"id":"one"}';
    expect(verifyInboundSignature(raw, signed(raw), secret, now)).toBe(true);
    expect(verifyInboundSignature(`${raw} `, signed(raw), secret, now)).toBe(false);
    expect(verifyInboundSignature(raw, signed(raw), `whsec_${Buffer.alloc(32, 18).toString("base64")}`, now)).toBe(false);
    expect(verifyInboundSignature(raw, signed(raw), secret, now + 301000)).toBe(false);
    expect(verifyInboundSignature(raw, new Headers(), secret, now)).toBe(false);
  });
  it("supports signature rotation without accepting malformed signatures", () => {
    const headers = signed("{}");
    headers.set("svix-signature", `v1,bad ${headers.get("svix-signature") ?? ""}`);
    expect(verifyInboundSignature("{}", headers, secret, now)).toBe(true);
  });
  it("routes only one unambiguous token in the configured domain", () => {
    const token = "a".repeat(64);
    expect(replyToken([`Mill <reply+${token}@reply.mill.chat>`], "reply.mill.chat")).toBe(token);
    expect(replyToken([`reply+${token}@evil.com`], "reply.mill.chat")).toBeNull();
    expect(replyToken([`reply+${token}@reply.mill.chat`, `reply+${"b".repeat(64)}@reply.mill.chat`], "reply.mill.chat")).toBeNull();
    expect(mailboxAddress("Visitor <Visitor@example.com>")).toBe("visitor@example.com");
  });
  it("keeps customer content and removes previous quoted conversation", () => {
    expect(incomingReplyText("Спасибо!\r\n\r\nOn Tue, Alex wrote:\r\n> previous")).toBe("Спасибо!");
    expect(incomingReplyText("My reply\n> old message")).toBe("My reply");
  });
  it("filters automatic replies and mailing list loops", () => {
    expect(isAutomatedEmail({ "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(isAutomatedEmail({ Precedence: "bulk" })).toBe(true);
    expect(isAutomatedEmail({ "Auto-Submitted": "no" })).toBe(false);
  });
});
