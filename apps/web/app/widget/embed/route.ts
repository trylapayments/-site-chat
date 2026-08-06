/**
 * Widget embed shell — intentionally NOT an App Router page.
 *
 * Mounting `app.js` into a Next.js-rendered `#root` races the App Router
 * client runtime, which removes that node during hydration/reconciliation
 * (especially when embed CSP blocks inline Flight scripts). Serving a raw
 * HTML document keeps the widget DOM outside Next's React tree.
 */
const EMBED_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Site Chat</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      #root {
        margin: 0;
        background: transparent;
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/widget/app.js"></script>
  </body>
</html>
`;

export function GET() {
  return new Response(EMBED_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
