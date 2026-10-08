import Link from "next/link";
import { accountDeletionPreviewAction } from "@/lib/account/actions";
import { DeleteOwnAccount } from "@/components/account/DeleteOwnAccount";
export default async function AccountPage() {
  const preview = await accountDeletionPreviewAction();
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-5 py-10">
      <Link href="/app" className="text-sm underline">
        Back to workspace
      </Link>
      <div>
        <h1 className="text-3xl font-semibold">Account settings</h1>
        <p className="mt-2 text-muted-foreground">
          Your login account: {preview.email}
        </p>
      </div>
      <DeleteOwnAccount initial={preview} />
    </main>
  );
}
