import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next) ?? undefined;

  return <LoginForm nextPath={nextPath} defaultEmail={params.email} />;
}
