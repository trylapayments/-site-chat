import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationCompany, unreadBadge, type CompanyConversation } from "./company-inbox.ts";
const companies = [
  { workspace_id: "company-a", slug: "a", name: "A", role: "owner" as const },
  { workspace_id: "company-b", slug: "b", name: "B", role: "viewer" as const },
];
const row = (id?: string) =>
  ({ id: "chat", ...(id ? { workspace: { id, name: id, slug: id } } : {}) }) as CompanyConversation;
test("an aggregate chat retains its actual company and permissions", () => {
  assert.equal(conversationCompany(row("company-b"), "all", companies)?.workspace_id, "company-b");
  assert.equal(conversationCompany(row("company-b"), "all", companies)?.role, "viewer");
});
test("aggregate rows without company identity never fall back to the selected company", () => {
  assert.equal(conversationCompany(row(), "all", companies), null);
});
test("a selected company excludes other-company conversations", () => {
  assert.equal(conversationCompany(row("company-b"), "company-a", companies), null);
});
test("membership removal invalidates cached aggregate rows", () => {
  assert.equal(conversationCompany(row("company-b"), "all", companies.slice(0, 1)), null);
});
test("single-company legacy responses retain their explicit request scope", () => {
  assert.equal(conversationCompany(row(), "company-a", companies)?.workspace_id, "company-a");
});
test("unread badges do not show invalid or negative values", () => {
  assert.equal(unreadBadge(-1), "");
  assert.equal(unreadBadge(NaN), "");
  assert.equal(unreadBadge(0), "");
  assert.equal(unreadBadge(5), "5");
  assert.equal(unreadBadge(120), "99+");
});
