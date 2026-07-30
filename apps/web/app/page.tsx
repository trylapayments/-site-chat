import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Site Chat</h1>
        <p className="text-muted-foreground mt-2 max-w-md text-lg">
          Customer messaging platform for websites. Foundation ready for
          development.
        </p>
      </div>
      <Button>Get started</Button>
    </main>
  );
}
