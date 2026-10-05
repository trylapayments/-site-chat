import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
export const requirePlatformAdministrator = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/admin/customers");
  if (!user.email_confirmed_at) notFound();
  const { data: administrator, error: permissionError } =
    await createServiceClient()
      .from("platform_administrators")
      .select("role")
      .eq("user_id", user.id)
      .eq("enabled", true)
      .maybeSingle();
  if (permissionError || !administrator) notFound();
  return { user, role: administrator.role };
});
