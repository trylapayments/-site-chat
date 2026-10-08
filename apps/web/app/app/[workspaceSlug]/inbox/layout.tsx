import { Suspense } from "react";
import { InboxBootstrap } from "@/components/inbox/workspace/InboxBootstrap";
export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<div role="status">Loading inbox…</div>}>
      <InboxBootstrap>{children}</InboxBootstrap>
    </Suspense>
  );
}
