import { expect, it } from "vitest";
import { isWorkspaceClientRoute, workspaceConversationId } from "./client-route";
it("handles only the three locally rendered pages in the current workspace", () => {
  for (const path of [
    "/app/demo",
    "/app/demo/inbox",
    "/app/demo/inbox?status=closed",
    "/app/demo/visitors",
  ])
    expect(isWorkspaceClientRoute(path, "demo")).toBe(true);
  for (const path of [
    "/app/other/inbox",
    "/app/demo/inbox/id",
    "/app/demo/settings",
    "https://other.example/app/demo",
    "/app/democracy",
  ])
    expect(isWorkspaceClientRoute(path, "demo")).toBe(false);
});

it("accepts only a UUID conversation under the current workspace", () => {
 const id = "a82f866d-a658-4a26-a5cd-924b1ff4586d";
 expect(isWorkspaceClientRoute(`/app/demo/inbox/${id}?message=${id}`, "demo")).toBe(true);
 expect(workspaceConversationId(`/app/demo/inbox/${id}`, "demo")).toBe(id);
 for (const route of [`/app/other/inbox/${id}`, `/app/demo/inbox/${id}/delete`, `/app/demo/inbox/not-an-id`, `https://other.example/app/demo/inbox/${id}`])
   expect(workspaceConversationId(route, "demo")).toBeNull();
});
