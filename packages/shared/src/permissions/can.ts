import { rolesForCapability, type DashboardCapability } from "./capabilities";
import type { MemberRole } from "../schemas/workspace";

export function can(role: MemberRole, capability: DashboardCapability): boolean {
  return rolesForCapability(capability).includes(role);
}
