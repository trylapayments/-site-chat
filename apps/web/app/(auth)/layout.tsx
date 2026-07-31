import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="absolute top-4 left-4">
        <Link href="/" className="text-sm font-semibold">
          Site Chat
        </Link>
      </div>
      {children}
    </div>
  );
}
