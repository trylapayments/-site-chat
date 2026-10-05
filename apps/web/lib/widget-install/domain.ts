import { z } from "zod";

/** Exact hostnames only: no wildcard, paths, ports, credentials or local IPs. */
export const installDomainSchema = z
  .string()
  .trim()
  .max(300)
  .transform((input, ctx) => {
    try {
      if (!/^(?:https?:\/\/)?[^\s:/?#@\\]+\/?$/i.test(input)) throw new Error();
      const url = new URL(input.includes("://") ? input : `https://${input}`);
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      const labels = host.split(".");
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        labels.length < 2 ||
        host.length > 253 ||
        /^\d+(\.\d+){3}$/.test(host) ||
        !labels.every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
        !/[a-z]/.test(labels.at(-1) ?? "")
      )
        throw new Error();
      return host;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Enter a domain such as example.com, without a path, port or wildcard.",
      });
      return z.NEVER;
    }
  });

export function buildInstallSnippet(appUrl: string, publicKey: string): string {
  const origin = new URL(appUrl).origin;
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return `<script\n  src="${escape(origin)}/widget/loader.js"\n  data-widget-key="${escape(publicKey)}"\n  async\n></script>`;
}
