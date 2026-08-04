import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@site-chat/shared"],
  typedRoutes: true,
  headers() {
    return Promise.resolve([
      {
        source: "/widget/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:;   connect-src 'self' http://127.0.0.1:54321 http://localhost:54321 ws://127.0.0.1:54321 ws://localhost:54321 https://*.supabase.co wss://*.supabase.co; frame-ancestors *; base-uri 'none'; form-action 'self'",
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
