export function isWorkspaceClientRoute(href: string, slug: string): boolean {
  const path = href.split(/[?#]/)[0] ?? "";
  const base = `/app/${slug}`;
  return (
    path === base || path === `${base}/inbox` || path === `${base}/visitors` || workspaceConversationId(path, slug) !== null
  );
}

export function workspaceConversationId(path: string, slug: string): string | null {
 const prefix = `/app/${slug}/inbox/`;
 if (!path.startsWith(prefix)) return null;
 const id = path.slice(prefix.length).split(/[?#]/)[0] ?? "";
 return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
