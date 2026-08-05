import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    environmentMatchGlobs: [["src/bundle-paths.test.ts", "node"]],
  },
});
