import { describe, expect, it } from "vitest";

import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";

describe("requireCapability", () => {
  it("passes when the role is allowed", () => {
    expect(() => {
      requireCapability("agent", "send_messages");
    }).not.toThrow();
  });

  it("throws CapabilityError when the role is denied", () => {
    expect(() => {
      requireCapability("viewer", "send_messages");
    }).toThrow(CapabilityError);
  });
});
