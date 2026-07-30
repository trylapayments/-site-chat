import eslintConfig from "@site-chat/eslint-config/base";

export default [
  ...eslintConfig,
  {
    ignores: ["dist/**", "src/database.types.ts"],
  },
];
