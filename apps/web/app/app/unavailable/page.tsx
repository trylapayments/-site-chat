import { SystemPageLayout } from "@/components/dashboard/SystemPageLayout";

export default function UnavailablePage() {
  return (
    <SystemPageLayout>
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Workspace unavailable
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base">
          Your account is linked to a workspace, but you do not currently have
          access. Contact a workspace owner or admin if you believe this is a
          mistake.
        </p>
      </div>
    </SystemPageLayout>
  );
}
