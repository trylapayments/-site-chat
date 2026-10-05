import { clientEnv } from "@/lib/env";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Mill</h1>
        <p className="text-muted-foreground mt-2 max-w-md text-lg">
          Live chat that connects your team with your customers.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <a
            href={new URL("/signup", clientEnv.NEXT_PUBLIC_APP_URL).toString()}
          >
            Get started
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={new URL("/login", clientEnv.NEXT_PUBLIC_APP_URL).toString()}>
            Sign in
          </a>
        </Button>
      </div>
    </main>
  );
}
