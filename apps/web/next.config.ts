import type { NextConfig } from "next";

// Self-hosted Supabase needs both HTTPS API and WSS realtime in the iframe CSP.
const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseConnectSources = configuredSupabaseUrl
  ? (() => {
      const url = new URL(configuredSupabaseUrl);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS");
      }
      const websocketUrl = new URL(url.origin);
      websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return `${url.origin} ${websocketUrl.origin}`;
    })()
  : "";

const nextConfig: NextConfig = {
  transpilePackages: ["@site-chat/shared"],
  typedRoutes: true,
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  headers() {
    return Promise.resolve([
      {
        source: "/widget/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: ${configuredSupabaseUrl ? new URL(configuredSupabaseUrl).origin : ""};   connect-src 'self' http://127.0.0.1:54321 http://localhost:54321 ws://127.0.0.1:54321 ws://localhost:54321 https://*.supabase.co wss://*.supabase.co ${supabaseConnectSources}; media-src 'self' blob: http://127.0.0.1:54321 http://localhost:54321 https://*.supabase.co ${supabaseConnectSources}; frame-ancestors *; base-uri 'none'; form-action 'self'`,
          },
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
