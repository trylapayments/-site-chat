import type { Route } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-muted/30 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
        {footer ? (
          <div className="text-muted-foreground px-6 pb-6 text-sm">
            {footer}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function AuthLink({
  href,
  children,
}: {
  href: Route;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-primary font-medium hover:underline">
      {children}
    </Link>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="text-destructive text-sm">{message}</p>;
}

export function FormMessage({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p className="bg-muted rounded-md px-3 py-2 text-sm" role="status">
      {message}
    </p>
  );
}
