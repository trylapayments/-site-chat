import { toAppRoute } from "@/lib/auth/redirect";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/PageHeader";
export default async function WorkspaceHomePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Manage your website chat, visitors and team."
      />
      <div className="rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Connect your website</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Install your Mill widget and allow your website domains to start
          receiving chats.
        </p>
        <Link
          href={toAppRoute(`/app/${workspaceSlug}/settings/install`)}
          className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Install widget
        </Link>
      </div>
    </div>
  );
}
