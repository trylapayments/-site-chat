import {
  CreditCard,
  Inbox,
  LayoutDashboard,
  Settings,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { DashboardNavIconKey } from "@/lib/dashboard/routes";

export const DASHBOARD_NAV_ICONS: Record<DashboardNavIconKey, LucideIcon> = {
  LayoutDashboard,
  CreditCard,
  Inbox,
  Users,
  UserCog,
  Settings,
};
