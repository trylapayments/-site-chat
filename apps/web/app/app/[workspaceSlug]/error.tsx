"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-start justify-center gap-4 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-muted-foreground max-w-xl text-base">
          This page failed to load. Try again, or return to your workspace home.
        </p>
      </div>
      <Button
        type="button"
        onClick={() => {
          reset();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
