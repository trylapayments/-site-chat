import { redirectAuthenticatedUser } from "@/lib/workspace/redirect.server";

export default async function AppPage() {
  await redirectAuthenticatedUser();
}
