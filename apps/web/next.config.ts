import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@site-chat/shared"],
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/widget/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'self'",
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
    ];
  },
};

export default nextConfig;
