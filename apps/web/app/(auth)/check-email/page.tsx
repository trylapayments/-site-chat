import { CheckEmailPanel } from "@/components/auth/CheckEmailPanel";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  return <CheckEmailPanel email={params.email} />;
}
