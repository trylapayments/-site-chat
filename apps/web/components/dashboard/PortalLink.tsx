"use client";

import Link from "next/link";
import { useOptionalPortalWorkspace } from "./PortalDataProvider";
import { isWorkspaceClientRoute } from "@/lib/portal/client-route";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";
import { startPageNavigation } from "@/lib/performance/interactions";
import { toAppRoute } from "@/lib/auth/redirect";

// Prepare only the route the operator points to, rather than all inbox rows.
// Normal route authorization still runs; writes always go to the server.
export function PortalLink({
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  const workspace = useOptionalPortalWorkspace();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPrepared = useRef({ href: "", at: 0 });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const prepare = () => {
    cancel();
    const href = props.href;
    if (
      props.prefetch === false ||
      typeof href !== "string" ||
      !href.startsWith("/app/")
    )
      return;
    if (workspace && isWorkspaceClientRoute(href, workspace.slug)) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (
        lastPrepared.current.href === href &&
        Date.now() - lastPrepared.current.at < 15000
      )
        return;
      lastPrepared.current = { href, at: Date.now() };
      router.prefetch(toAppRoute(href));
    }, 100);
  };
  return (
    <Link
      {...props}
      prefetch={
        workspace &&
        typeof props.href === "string" &&
        isWorkspaceClientRoute(props.href, workspace.slug)
          ? false
          : (props.prefetch ?? false)
      }
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          typeof props.href === "string"
        ) {
          if (props.href.split(/[?#]/)[0] !== window.location.pathname)
            startPageNavigation(props.href);
          if (
            workspace &&
            (!props.target || props.target === "_self") &&
            isWorkspaceClientRoute(props.href, workspace.slug)
          ) {
            event.preventDefault();
            window.history.pushState(null, "", props.href);
          }
        }
      }}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        prepare();
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        cancel();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        prepare();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        cancel();
      }}
    />
  );
}
