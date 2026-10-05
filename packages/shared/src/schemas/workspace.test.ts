import { describe, expect, it } from "vitest";

import { createWorkspaceResultSchema } from "./workspace.js";

describe("createWorkspaceResultSchema", () => {
  it("accepts the create_workspace RPC response including its widget key", () => {
    const response = {
      workspace_id: "22222222-2222-2222-2222-222222222222",
      slug: "staging-smoke",
      name: "Staging Smoke",
      widget_public_key: "wk_22222222222222222222222222222222",
    };

    expect(createWorkspaceResultSchema.parse(response)).toEqual(response);
  });
});
