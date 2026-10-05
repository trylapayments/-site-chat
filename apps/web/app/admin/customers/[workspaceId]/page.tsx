import { notFound } from "next/navigation";
import { z } from "zod";
import { loadPlatformCustomer } from "@/lib/platform-admin/data";
import { PlatformCustomerCard } from "@/components/platform-admin/PlatformCustomerCard";
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (!z.string().uuid().safeParse(workspaceId).success) notFound();
  return (
    <PlatformCustomerCard data={await loadPlatformCustomer(workspaceId)} />
  );
}
