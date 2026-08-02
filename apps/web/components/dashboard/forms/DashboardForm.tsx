import { FieldError } from "@/components/dashboard/forms/FieldError";
import { cn } from "@/lib/utils";

export function DashboardForm({
  action,
  children,
  className,
}: {
  action?: string | ((formData: FormData) => void);
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form action={action} className={cn("space-y-4", className)}>
      {children}
    </form>
  );
}

export function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      <FieldError message={error} />
    </div>
  );
}
