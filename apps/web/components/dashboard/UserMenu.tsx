"use client";

import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import { IdentityAvatar } from "@/components/dashboard/IdentityAvatar";
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
          className="mill-user-menu max-w-full truncate"
          aria-label="Account menu"
        >
          <IdentityAvatar
            label={email}
            className="size-7 rounded-lg text-[10px]"
          />
          <span className="min-w-0 flex-1 truncate text-left">{email}</span>
          <ChevronsUpDown className="size-3 shrink-0" aria-hidden="true" />
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
          <Link href="/app/account">Account settings</Link>
        </DropdownMenuItem>
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
