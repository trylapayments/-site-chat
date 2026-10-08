import { SignOutButton } from "@/components/auth/SignOutButton";

export function SystemPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 flex justify-end">
        <SignOutButton />
      </div>
      {children}
    </div>
  );
}
