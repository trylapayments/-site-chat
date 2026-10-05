import { expect, it } from "vitest";
import { applicationHostRedirect } from "./application-host";
it("moves application routes off the marketing domain while preserving their path", () => {
  expect(applicationHostRedirect("mill.chat", "/app/millcorn/inbox")).toEqual({
    hostname: "app.mill.chat",
    pathname: "/app/millcorn/inbox",
  });
  expect(applicationHostRedirect("www.mill.chat", "/auth/recovery")).toEqual({
    hostname: "app.mill.chat",
    pathname: "/auth/recovery",
  });
});
it("keeps marketing, legacy widget embeds and unrelated hosts untouched", () => {
  for (const path of [
    "/",
    "/widget/embed",
    "/api/v1/widget/bootstrap",
    "/pricing",
  ])
    expect(applicationHostRedirect("mill.chat", path)).toBeNull();
  expect(applicationHostRedirect("mill.chat.evil.com", "/login")).toBeNull();
  expect(applicationHostRedirect("localhost", "/app/acme-support")).toBeNull();
});
it("opens the app dashboard at the application root without a redirect loop", () => {
  expect(applicationHostRedirect("app.mill.chat", "/")).toEqual({
    hostname: "app.mill.chat",
    pathname: "/app",
  });
  expect(applicationHostRedirect("app.mill.chat", "/app")).toBeNull();
});
