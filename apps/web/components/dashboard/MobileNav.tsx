"use client";

import { PlatformAdminLink } from "@/components/dashboard/PlatformAdminLink";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  MILL_DIALOGUE_MARK,
  type AccessibleWorkspace,
} from "@site-chat/shared";

import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { OperatorAvailability } from "@/components/dashboard/OperatorAvailability";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { WorkspaceSwitcher } from "@/components/dashboard/WorkspaceSwitcher";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  resolveActiveNavItemId,
  resolveSectionLabel,
} from "@/lib/dashboard/navigation";

export function MobileNav({
  slug,
  workspaces,
  currentWorkspaceId,
  memberId,
  email,
  canAdministerPlatform = false,
}: {
  slug: string;
  workspaces: AccessibleWorkspace[];
  currentWorkspaceId: string;
  memberId: string;
  email: string;
  canAdministerPlatform?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const sectionLabel = resolveSectionLabel(
    resolveActiveNavItemId(pathname, slug),
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="lg:hidden"
          aria-label="Open menu"
          aria-expanded={open}
        >
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="mill-operator w-72 overflow-y-auto p-0"
      >
        <SheetHeader className="border-border border-b px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-3 text-xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline brand asset */}
            <img src={MILL_DIALOGUE_MARK} alt="" className="size-9" />
            Mill
          </SheetTitle>
          {sectionLabel ? (
            <p className="text-muted-foreground text-sm">{sectionLabel}</p>
          ) : null}
        </SheetHeader>
        <div className="space-y-4 p-4">
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            currentPath={pathname}
          />
          <Separator />
          <DashboardNav
            canManageBilling={workspaces.some(
              (w) =>
                w.workspace_id === currentWorkspaceId &&
                ["owner", "admin"].includes(w.role),
            )}
            slug={slug}
            workspaceId={currentWorkspaceId}
            memberId={memberId}
            onNavigate={() => {
              setOpen(false);
            }}
          />
          <Separator />
          {workspaces.some(
            (workspace) =>
              workspace.workspace_id === currentWorkspaceId &&
              workspace.role !== "viewer",
          ) ? (
            <OperatorAvailability key={slug} slug={slug} />
          ) : null}
          {canAdministerPlatform ? (
            <PlatformAdminLink
              onNavigate={() => {
                setOpen(false);
              }}
            />
          ) : null}
          <UserMenu email={email} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
