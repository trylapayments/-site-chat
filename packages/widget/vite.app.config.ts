import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * ESM app bundle (app.js + locale chunks).
 * Built after the loader IIFE pass with emptyOutDir: false so loader.js is kept.
 */
export default defineConfig({
  // CI sets NODE_ENV=test; pin Vite mode so minify/define match committed output.
  mode: "production",
  plugins: [
    react({
      // Force production JSX so bundles never embed machine-specific jsxDEV
      // fileName metadata when NODE_ENV=test in CI.
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
    emptyOutDir: false,
    rollupOptions: {
      maxParallelFileOps: 1,
      input: {
        app: resolve(__dirname, "src/app/main.tsx"),
      },
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        // Keep locale dictionaries as separate hashed chunks for lazy load + CSP.
        manualChunks(id) {
          if (id.includes("/i18n/locales/")) {
            const match = id.match(/locales\/([^/]+)\.ts$/);
            if (match?.[1] && match[1] !== "en") {
              return `locale-${match[1]}`;
            }
          }
          return undefined;
        },
      },
    },
  },
});
