import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@site-chat/shared"],
  typedRoutes: true,
};

export default nextConfig;
