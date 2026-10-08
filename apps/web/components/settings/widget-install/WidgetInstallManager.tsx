"use client";

import { useState, useTransition } from "react";
import { Copy, Code, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setInstallDomainAction } from "@/lib/widget-install/actions";

type Domain = { id: string; domain: string; verified: boolean };
export function WidgetInstallManager({
  slug,
  snippet,
  initialDomains,
  canManage,
  siteLimit,
}: {
  slug: string;
  snippet: string;
  initialDomains: Domain[];
  canManage: boolean;
  siteLimit?: number;
}) {
  const [domains, setDomains] = useState(initialDomains);
  const [domain, setDomain] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function update(host: string, enabled: boolean) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await setInstallDomainAction(slug, {
        domain: host,
        enabled,
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setDomains((current) =>
        [
          ...current.filter((row) => row.id !== result.domain.id),
          result.domain,
        ].sort((a, b) => a.domain.localeCompare(b.domain)),
      );
      setDomain("");
      setMessage(
        enabled
          ? `${result.domain.domain} is allowed.`
          : `${result.domain.domain} is blocked. The widget will stop working on this domain.`,
      );
    });
  }
  return (
    <div className="max-w-3xl space-y-6" data-testid="widget-install-page">
      <PageHeader
        title="Install widget"
        description="Add Mill to your website and control where your widget can run."
      />
      {siteLimit !== undefined ? (
        <p className="rounded-xl border bg-white p-4 text-sm">
          {
            new Set(
              domains
                .filter((d) => d.verified)
                .map((d) => d.domain.toLowerCase().replace(/^www\./, "")),
            ).size
          }{" "}
          / {siteLimit} websites enabled. Addresses with and without www count
          as one website.{" "}
          {canManage ? (
            <a className="text-brand underline" href={`/app/${slug}/billing`}>
              Manage plan
            </a>
          ) : null}
        </p>
      ) : null}
      <a
        className="inline-block text-blue-600 underline"
        href={`/app/${slug}/settings/widget-studio`}
      >
        Configure design and chat rules for each website
      </a>
      <section
        className="space-y-4 rounded-xl border p-4 sm:p-6"
        aria-labelledby="install-code-title"
      >
        <h2
          id="install-code-title"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <Code className="size-5" /> Website installation
        </h2>
        <p className="text-sm text-muted-foreground">
          Allow your website domain below, then paste this code before the
          closing &lt;/body&gt; tag on every page where you want the chat.
        </p>
        <label className="block text-sm font-medium" htmlFor="install-code">
          Your widget code
        </label>
        <textarea
          id="install-code"
          readOnly
          value={snippet}
          rows={6}
          className="w-full resize-none rounded-md border bg-muted p-3 font-mono text-xs"
        />
        <Button
          variant="outline"
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(snippet);
                setMessage("Widget code copied.");
                setError("");
              } catch {
                setError("Select and copy the code above.");
              }
            })();
          }}
        >
          <Copy className="mr-2 size-4" /> Copy code
        </Button>
        <p className="text-sm text-muted-foreground">
          For WordPress, Shopify or another site builder, use its custom code or
          footer scripts setting. The script creates the chat iframe
          automatically.
        </p>
      </section>
      <section
        className="space-y-4 rounded-xl border p-4 sm:p-6"
        aria-labelledby="allowed-domains-title"
      >
        <h2
          id="allowed-domains-title"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <ShieldCheck className="size-5" /> Allowed domains
        </h2>
        <p className="text-sm text-muted-foreground">
          Your widget only works on allowed domains. Add example.com and
          www.example.com separately if you use both. Other subdomains are
          blocked unless you allow them explicitly.
        </p>
        {canManage ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              update(domain, true);
            }}
          >
            <Input
              aria-label="Website domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
              }}
              maxLength={300}
              required
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !domain.trim()}>
              Allow domain
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask a workspace owner or admin to manage this list.
          </p>
        )}
        {!domains.some((row) => row.verified) && (
          <p className="rounded-md bg-muted p-3 text-sm">
            No domains are allowed. The widget is blocked on all websites until
            you add one.
          </p>
        )}
        <ul className="divide-y rounded-md border">
          {domains.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium">{row.domain}</p>
                <p className="text-xs text-muted-foreground">
                  {row.verified ? "Allowed" : "Blocked"}
                </p>
              </div>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  aria-label={`${row.verified ? "Block" : "Allow"} ${row.domain}`}
                  onClick={() => {
                    update(row.domain, !row.verified);
                  }}
                >
                  {row.verified ? "Block" : "Allow"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Blocking a domain also prevents existing widget sessions from making
          further requests. You can allow it again at any time.
        </p>
      </section>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
