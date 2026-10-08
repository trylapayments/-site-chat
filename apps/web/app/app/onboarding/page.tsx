import { OnboardingForm } from "@/components/workspace/OnboardingForm";
import { SystemPageLayout } from "@/components/dashboard/SystemPageLayout";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";
import { redirect } from "next/navigation";
import { toAppRoute } from "@/lib/auth/redirect";

export default async function OnboardingPage() {
  const { membership } = await getWorkspaceContext();

  if (membership.total_membership_count > 0) {
    redirect(toAppRoute("/app"));
  }

  return (
    <SystemPageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Create your workspace
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-base">
            Set up the workspace your team will use to manage customer
            conversations.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </SystemPageLayout>
  );
}
