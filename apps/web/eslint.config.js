import nextConfig from "@site-chat/eslint-config/nextjs";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
];
