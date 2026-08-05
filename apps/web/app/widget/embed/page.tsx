export default function WidgetEmbedPage() {
  return (
    <>
      <div
        id="root"
        style={{ margin: 0, background: "transparent", minHeight: "100vh" }}
      />
      {/* Native module script required for CSP-safe boot without Next hydration. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script type="module" src="/widget/app.js" />
    </>
  );
}
