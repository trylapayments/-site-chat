import { PortalPageReady } from "./PortalPageReady";
export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mill-page-heading space-y-2">
      <PortalPageReady />
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground max-w-2xl text-base">{description}</p>
    </header>
  );
}
