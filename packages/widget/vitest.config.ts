import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __SITECHAT_SUPABASE_URL__: JSON.stringify(""),
    __SITECHAT_SUPABASE_KEY__: JSON.stringify(""),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    environmentMatchGlobs: [["src/bundle-paths.test.ts", "node"]],
  },
});
