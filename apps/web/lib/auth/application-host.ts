/** Keep the public website separate from the authenticated application. */
export function applicationHostRedirect(
  hostname: string,
  pathname: string,
): { hostname: string; pathname: string } | null {
  const host = hostname.toLowerCase();
  if (host === "app.mill.chat" && pathname === "/")
    return { hostname: host, pathname: "/app" };
  const applicationPath =
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    ["/login", "/signup", "/forgot-password", "/reset-password"].includes(
      pathname,
    ) ||
    pathname.startsWith("/auth/") ||
    pathname === "/invite" ||
    pathname.startsWith("/invite/");
  if ((host === "mill.chat" || host === "www.mill.chat") && applicationPath)
    return { hostname: "app.mill.chat", pathname };
  return null;
}
