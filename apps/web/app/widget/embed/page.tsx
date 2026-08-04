import Script from "next/script";

export default function WidgetEmbedPage() {
  return (
    <div
      id="root"
      style={{ margin: 0, background: "transparent", minHeight: "100vh" }}
    >
      <Script src="/widget/app.js" type="module" strategy="afterInteractive" />
    </div>
  );
}
