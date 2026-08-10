import eslintConfig from "@site-chat/eslint-config/base";

export default [
  ...eslintConfig,
  {
    ignores: ["dist/**", "vitest.config.ts"],
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
];
