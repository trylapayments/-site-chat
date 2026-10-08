import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    email?: string;
    accountDeleted?: string;
  }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeRedirectPath(params.next) ?? undefined;

  return (
    <>
      {params.accountDeleted === "1" && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          Your account has been deleted. Personal company data cleanup continues
          in the background.
        </p>
      )}
      <LoginForm nextPath={nextPath} defaultEmail={params.email} />
    </>
  );
}
