import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Classic-script IIFE build for loader.js.
 * Host pages load this without type="module"; ESM imports would silently fail.
 * Built first (emptyOutDir: true). See vite.app.config.ts for the app pass.
 */
export default defineConfig({
  // CI sets NODE_ENV=test; pin Vite mode so minify/define match committed output.
  mode: "production",
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
