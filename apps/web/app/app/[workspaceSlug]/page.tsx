export default async function WorkspaceHomePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Workspace home</h1>
      <p className="text-muted-foreground max-w-2xl text-base">
        You are in <span className="font-medium">{workspaceSlug}</span>. Inbox
        and settings arrive in later phases.
      </p>
    </div>
  );
}
