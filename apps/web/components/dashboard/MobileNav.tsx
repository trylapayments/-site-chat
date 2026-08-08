"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import type { AccessibleWorkspace } from "@site-chat/shared";

import { DashboardNav } from "@/components/dashboard/DashboardNav";
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
}: {
  slug: string;
  workspaces: AccessibleWorkspace[];
  currentWorkspaceId: string;
  memberId: string;
  email: string;
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
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-border border-b px-4 py-4 text-left">
          <SheetTitle className="text-base">Site Chat</SheetTitle>
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
            slug={slug}
            workspaceId={currentWorkspaceId}
            memberId={memberId}
            onNavigate={() => {
              setOpen(false);
            }}
          />
          <Separator />
          <UserMenu email={email} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
