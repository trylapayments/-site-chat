import {
  can,
  type DashboardCapability,
  type MemberRole,
} from "@site-chat/shared";

export class CapabilityError extends Error {
  readonly capability: DashboardCapability;
  readonly role: MemberRole;

  constructor(role: MemberRole, capability: DashboardCapability) {
    super("You do not have permission to perform this action.");
    this.name = "CapabilityError";
    this.role = role;
    this.capability = capability;
  }
}

export function requireCapability(
  role: MemberRole,
  capability: DashboardCapability,
): void {
  if (!can(role, capability)) {
    throw new CapabilityError(role, capability);
  }
}
