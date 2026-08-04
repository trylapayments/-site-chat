import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Site Chat",
};

export default function WidgetEmbedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
