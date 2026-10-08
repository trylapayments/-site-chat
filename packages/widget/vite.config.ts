import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Default `vite build` entry used by package scripts.
 * Prefer the dual-pass scripts (loader IIFE then app ESM) via package.json `build`.
 * This file remains for Vitest / tooling that expects vite.config.ts.
 *
 * IMPORTANT: Do not use a multi-entry ESM build for loader+app together — shared
 * chunks emit `import` into loader.js, which breaks classic <script> embeds.
 */
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: "automatic",
    }),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __SITECHAT_SUPABASE_URL__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    __SITECHAT_SUPABASE_KEY__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
  },
  esbuild: {
    jsxDev: false,
  },
  build: {
    outDir: resolve(__dirname, "../../apps/web/public/widget"),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/loader/index.ts"),
      name: "SiteChatLoader",
      formats: ["iife"],
      fileName: () => "loader.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "loader.js",
      },
    },
  },
});
