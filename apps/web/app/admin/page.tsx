import { toAppRoute } from "@/lib/auth/redirect";
import { redirect } from "next/navigation";
export default function PlatformHome() {
  redirect(toAppRoute("/admin/customers"));
}
