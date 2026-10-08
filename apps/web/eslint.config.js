import nextConfig from "@site-chat/eslint-config/nextjs";

export default [
  ...nextConfig,
  {
    ignores: [".next/**", "next-env.d.ts", "public/widget/**"],
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["lib/auth/redirect.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    files: ["lib/widget/service.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
];
