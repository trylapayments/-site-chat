"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { toAppRoute } from "@/lib/auth/redirect";
import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ email }: { email: string }) {
  const params = useParams<{ workspaceSlug?: string }>();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[12rem] truncate"
          aria-label="Account menu"
        >
          <span className="truncate">{email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {params.workspaceSlug ? (
          <DropdownMenuItem asChild>
            <Link
              href={toAppRoute(`/app/${params.workspaceSlug}/settings/profile`)}
            >
              My profile
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <form action={signOutAction} className="w-full">
            <button type="submit" className="w-full cursor-pointer text-left">
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
