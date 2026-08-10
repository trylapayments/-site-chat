import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.integration.test.ts",
      "app/widget/embed/**/*.test.ts",
      "app/widget/embed/**/*.test.tsx",
      "app/api/v1/widget/realtime-token/**/*.test.ts",
      "app/api/v1/widget/identify/**/*.test.ts",
      "app/api/v1/widget/page-view/**/*.test.ts",
      "app/api/v1/inbox/ai/suggested-replies/**/*.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
