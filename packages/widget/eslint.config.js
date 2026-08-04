import eslintConfig from "@site-chat/eslint-config/base";

export default [
  ...eslintConfig,
  {
    ignores: ["dist/**"],
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
];
